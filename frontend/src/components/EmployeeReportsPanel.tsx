import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader, MessageSquare, RefreshCw, Send } from 'lucide-react';
import { toast } from 'sonner';
import { getMyThreatReports, submitThreatReport } from '../services/threatReportService';
import { Linkify } from '../mybodaguy/utils/linkify';

const THREAT_TYPES = [
  { value: 'phishing', label: 'Phishing' },
  { value: 'malware', label: 'Malware' },
  { value: 'suspicious_email', label: 'Suspicious Email' },
  { value: 'unauthorized_access', label: 'Unauthorized Access' },
  { value: 'data_breach', label: 'Data Breach' },
  { value: 'social_engineering', label: 'Social Engineering' },
  { value: 'other', label: 'Other' },
];

const SEVERITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

const STATUS_COLORS = {
  open: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800',
  investigating:
    'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800',
  resolved:
    'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-300 dark:border-green-800',
  dismissed:
    'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
};

export function EmployeeReportsPanel() {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [reports, setReports] = useState<any[]>([]);
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);

  const [type, setType] = useState('phishing');
  const [severity, setSeverity] = useState('medium');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [affectedSystems, setAffectedSystems] = useState('');

  const stats = useMemo(
    () => ({
      total: reports.length,
      open: reports.filter((item) => item.status === 'open').length,
      resolved: reports.filter((item) => item.status === 'resolved').length,
    }),
    [reports],
  );

  const loadReports = async () => {
    setLoading(true);
    try {
      const rows = await getMyThreatReports();
      setReports(rows || []);
    } catch (error: any) {
      toast.error(error?.message || 'Failed to load your reports');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReports();
  }, []);

  const resetForm = () => {
    setType('phishing');
    setSeverity('medium');
    setTitle('');
    setDescription('');
    setAffectedSystems('');
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !description.trim()) {
      toast.error('Title and description are required');
      return;
    }

    setSubmitting(true);
    try {
      await submitThreatReport({
        type,
        severity,
        title: title.trim(),
        description: description.trim(),
        affectedSystems: affectedSystems.trim() || null,
      });
      toast.success('Threat report submitted. Admin team has been notified.');
      resetForm();
      await loadReports();
    } catch (error: any) {
      toast.error(error?.message || 'Failed to submit report');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Report a Threat</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Reports are visible to admins only. You can track admin replies below.
            </p>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-xs">
            <span className="px-2 py-1 rounded-full border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
              Total: {stats.total}
            </span>
            <span className="px-2 py-1 rounded-full border border-blue-200 text-blue-700 dark:border-blue-800 dark:text-blue-300">
              Open: {stats.open}
            </span>
            <span className="px-2 py-1 rounded-full border border-green-200 text-green-700 dark:border-green-800 dark:text-green-300">
              Resolved: {stats.resolved}
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <select
              value={type}
              onChange={(event) => setType(event.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
            >
              {THREAT_TYPES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>

            <select
              value={severity}
              onChange={(event) => setSeverity(event.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
            >
              {SEVERITIES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Title"
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
          />

          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Describe what happened"
            rows={4}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white resize-none"
          />

          <input
            type="text"
            value={affectedSystems}
            onChange={(event) => setAffectedSystems(event.target.value)}
            placeholder="Affected systems (optional)"
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
          />

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? <Loader className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Submit Report
          </button>
        </form>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">My Reports</h3>
          <button
            onClick={() => void loadReports()}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="py-10 text-sm text-slate-600 dark:text-slate-400 flex items-center justify-center gap-2">
            <Loader className="w-4 h-4 animate-spin" />
            Loading reports...
          </div>
        ) : reports.length === 0 ? (
          <div className="py-10 text-center text-slate-600 dark:text-slate-400">
            <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-70" />
            No reports submitted yet.
          </div>
        ) : (
          <div className="space-y-3">
            {reports.map((report) => {
              const isExpanded = expandedReportId === report.id;
              return (
                <div key={report.id} className="border border-slate-200 dark:border-slate-700 rounded-lg">
                  <button
                    onClick={() => setExpandedReportId(isExpanded ? null : report.id)}
                    className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900 dark:text-white truncate">{report.title}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                          {new Date(report.createdAt).toLocaleString()} · {report.type.replaceAll('_', ' ')}
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

                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-slate-200 dark:border-slate-700 space-y-3">
                      <div>
                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Description</p>
                        <p className="text-sm text-slate-700 dark:text-slate-300">{report.description}</p>
                      </div>

                      {report.affectedSystems && (
                        <div>
                          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Affected Systems</p>
                          <p className="text-sm text-slate-700 dark:text-slate-300">{report.affectedSystems}</p>
                        </div>
                      )}

                      <div>
                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-2">
                          <MessageSquare className="w-3 h-3" />
                          Admin Replies
                        </p>
                        {report.replies?.length > 0 ? (
                          <div className="space-y-2">
                            {report.replies.map((reply) => (
                              <div
                                key={reply.id}
                                className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 px-3 py-2"
                              >
                                <p className="text-sm text-slate-800 dark:text-slate-200"><Linkify text={reply.message} /></p>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                                  {new Date(reply.createdAt).toLocaleString()}
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-slate-500 dark:text-slate-400">No admin replies yet.</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default EmployeeReportsPanel;

