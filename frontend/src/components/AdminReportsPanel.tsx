import { useEffect, useMemo, useState } from 'react';
import { CheckCircle, Clock, Loader, MessageSquare, RefreshCw, Send, ShieldAlert, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  getAdminCompanyThreatReports,
  replyToThreatReport,
  updateThreatReportStatus,
} from '../services/threatReportService';
import { Linkify } from '../mybodaguy/utils/linkify';

type Props = {
  companyId: string;
};

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'investigating', label: 'Investigating' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'dismissed', label: 'Dismissed' },
];

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800',
  investigating:
    'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800',
  resolved:
    'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-300 dark:border-green-800',
  dismissed:
    'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
};

const SEVERITY_COLORS: Record<string, string> = {
  low: 'text-green-700 dark:text-green-400',
  medium: 'text-amber-700 dark:text-amber-400',
  high: 'text-orange-700 dark:text-orange-400',
  critical: 'text-red-700 dark:text-red-400',
};

export function AdminReportsPanel({ companyId }: Props) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reports, setReports] = useState<any[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [replyText, setReplyText] = useState('');
  const [replyStatus, setReplyStatus] = useState('investigating');

  const loadReports = async () => {
    setLoading(true);
    try {
      const rows = await getAdminCompanyThreatReports(companyId);
      setReports(rows || []);
    } catch (error: any) {
      toast.error(error?.message || 'Failed to load threat reports');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!companyId) return;
    void loadReports();
  }, [companyId]);

  const selectedReport = useMemo(
    () => reports.find((item) => item.id === selectedReportId) || null,
    [reports, selectedReportId],
  );

  const filteredReports = useMemo(() => {
    return reports.filter((item) => {
      const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
      const matchesSeverity = severityFilter === 'all' || item.severity === severityFilter;
      const query = searchTerm.trim().toLowerCase();
      const matchesQuery =
        query.length === 0 ||
        item.title.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query) ||
        String(item.reporterEmail || '').toLowerCase().includes(query) ||
        String(item.reporterName || '').toLowerCase().includes(query);
      return matchesStatus && matchesSeverity && matchesQuery;
    });
  }, [reports, statusFilter, severityFilter, searchTerm]);

  const handleStatusOnlyUpdate = async (reportId: string, status: string) => {
    setBusy(true);
    try {
      await updateThreatReportStatus(reportId, status);
      toast.success('Report status updated');
      await loadReports();
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update status');
    } finally {
      setBusy(false);
    }
  };

  const handleReply = async () => {
    if (!selectedReportId) return;
    if (!replyText.trim()) {
      toast.error('Reply message is required');
      return;
    }

    setBusy(true);
    try {
      await replyToThreatReport(selectedReportId, replyText.trim(), replyStatus || null);
      toast.success('Reply sent to employee');
      setReplyText('');
      await loadReports();
    } catch (error: any) {
      toast.error(error?.message || 'Failed to send reply');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row gap-2 md:items-center md:justify-between">
        <h3 className="text-lg font-bold text-slate-900 dark:text-white">Threat Reports</h3>
        <button
          onClick={() => void loadReports()}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2">
        <input
          type="text"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Search title, reporter, email..."
          className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
        />
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
        >
          <option value="all">All Statuses</option>
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          value={severityFilter}
          onChange={(event) => setSeverityFilter(event.target.value)}
          className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
        >
          <option value="all">All Severity</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border border-slate-200 dark:border-slate-700 rounded-lg max-h-[600px] overflow-y-auto divide-y divide-slate-200 dark:divide-slate-700">
          {loading ? (
            <div className="py-10 text-sm text-slate-600 dark:text-slate-400 flex items-center justify-center gap-2">
              <Loader className="w-4 h-4 animate-spin" />
              Loading reports...
            </div>
          ) : filteredReports.length === 0 ? (
            <div className="py-12 text-center text-slate-600 dark:text-slate-400">
              <ShieldAlert className="w-8 h-8 mx-auto mb-2 opacity-70" />
              No matching reports.
            </div>
          ) : (
            filteredReports.map((report) => (
              <button
                key={report.id}
                onClick={() => {
                  setSelectedReportId(report.id);
                  setReplyStatus(report.status || 'investigating');
                }}
                className={`w-full text-left p-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                  selectedReportId === report.id ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{report.title}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 truncate">
                      {report.reporterName || report.reporterEmail} · {report.reporterDepartmentName || 'No department'}
                    </p>
                    <p className={`text-xs mt-1 font-medium ${SEVERITY_COLORS[report.severity] || 'text-slate-600'}`}>
                      {String(report.severity || '').toUpperCase()}
                    </p>
                  </div>
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded-full border ${
                      STATUS_COLORS[report.status] || STATUS_COLORS.open
                    }`}
                  >
                    {report.status}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>

        <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 bg-white dark:bg-slate-900">
          {!selectedReport ? (
            <div className="h-full min-h-[320px] flex flex-col items-center justify-center text-center text-slate-600 dark:text-slate-400">
              <MessageSquare className="w-8 h-8 mb-2 opacity-70" />
              Select a report to review details and reply.
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <h4 className="text-base font-semibold text-slate-900 dark:text-white">{selectedReport.title}</h4>
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded-full border ${
                      STATUS_COLORS[selectedReport.status] || STATUS_COLORS.open
                    }`}
                  >
                    {selectedReport.status}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Reporter: {selectedReport.reporterName || selectedReport.reporterEmail || selectedReport.reporterId}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Submitted: {new Date(selectedReport.createdAt).toLocaleString()}
                </p>
              </div>

              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-slate-50 dark:bg-slate-800/40">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Description</p>
                <p className="text-sm text-slate-700 dark:text-slate-300">{selectedReport.description}</p>
                {selectedReport.affectedSystems && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                    Affected Systems: {selectedReport.affectedSystems}
                  </p>
                )}
              </div>

              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">Conversation</p>
                <div className="max-h-44 overflow-y-auto space-y-2">
                  {selectedReport.replies?.length > 0 ? (
                    selectedReport.replies.map((reply) => (
                      <div
                        key={reply.id}
                        className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 px-3 py-2"
                      >
                        <p className="text-sm text-slate-800 dark:text-slate-200"><Linkify text={reply.message} /></p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                          {new Date(reply.createdAt).toLocaleString()} · {reply.authorRole}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-slate-500 dark:text-slate-400">No replies yet.</p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <textarea
                  value={replyText}
                  onChange={(event) => setReplyText(event.target.value)}
                  rows={3}
                  placeholder="Write your reply to the employee..."
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white resize-none"
                />

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={replyStatus}
                    onChange={(event) => setReplyStatus(event.target.value)}
                    className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm"
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={() => void handleReply()}
                    disabled={busy || !replyText.trim()}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-sm"
                  >
                    {busy ? <Loader className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Reply + Update
                  </button>

                  <button
                    onClick={() => void handleStatusOnlyUpdate(selectedReport.id, replyStatus)}
                    disabled={busy}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed text-sm"
                  >
                    {replyStatus === 'resolved' ? <CheckCircle className="w-4 h-4" /> : replyStatus === 'dismissed' ? <XCircle className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                    Update Status Only
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default AdminReportsPanel;

