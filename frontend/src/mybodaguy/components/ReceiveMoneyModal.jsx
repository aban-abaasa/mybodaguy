/**
 * Receive Money Modal Component
 * Displays QR code, payment link, and handles payment requests
 */

import React, { useState, useEffect } from 'react';
import { ArrowDownLeft, Copy, X, Download, Loader } from 'lucide-react';
import { QRCodeCanvas as QRCode } from 'qrcode.react';
import {
  createIcanPaymentRequest,
  getActiveIcanPaymentRequests,
  deleteIcanPaymentRequest,
} from '../services/icanPaymentRequestService';

const ReceiveMoneyModal = ({ 
  isOpen, 
  onClose, 
  userId,
  selectedCurrency = 'ICAN',
  onSuccess = null 
}) => {
  const initialFormData = {
    amount: '',
    description: ''
  };

  const [step, setStep] = useState('form'); // 'form', 'qrcode', 'active' - REMOVED 'choice', 'pay', 'scanner'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  
  // Form state
  const [formData, setFormData] = useState(initialFormData);

  // QR Code state
  const [qrData, setQrData] = useState(null);
  const [paymentLink, setPaymentLink] = useState('');
  const [activeRequests, setActiveRequests] = useState([]);

  const resetModalState = () => {
    setStep('form');
    setLoading(false);
    setError(null);
    setSuccessMessage(null);
    setFormData(initialFormData);
    setQrData(null);
    setPaymentLink('');
    setActiveRequests([]);
  };

  const handleCloseModal = () => {
    resetModalState();
    onClose();
  };

  useEffect(() => {
    if (!isOpen) return undefined;

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        handleCloseModal();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      resetModalState();
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && step === 'active') {
      loadActiveRequests();
    }
  }, [isOpen, step]);

  const loadActiveRequests = async () => {
    try {
      setActiveRequests(await getActiveIcanPaymentRequests(userId));
    } catch (err) {
      console.error('Error loading active requests:', err);
    }
  };

  const handleGenerateQR = async (e) => {
    e.preventDefault();
    
    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      const request = await createIcanPaymentRequest({
        userId,
        icanAmount: parseFloat(formData.amount),
        description: formData.description,
      });
      setQrData(request);
      setPaymentLink(request.qrValue);
      setSuccessMessage(`Payment request created for ${formData.amount} ICAN`);
      setStep('qrcode');
    } catch (err) {
      setError(err.message || 'Failed to generate QR code');
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(paymentLink);
    setSuccessMessage('Payment link copied to clipboard!');
    setTimeout(() => setSuccessMessage(null), 2000);
  };

  const handleDownloadQR = () => {
    const qrCodeElement = document.getElementById('qr-code-download');
    if (qrCodeElement) {
      const link = document.createElement('a');
      link.href = qrCodeElement.toDataURL('image/png');
      link.download = `payment-qr-${qrData.payment_code}.png`;
      link.click();
    }
  };

  const handleDeleteRequest = async (paymentCode) => {
    try {
      await deleteIcanPaymentRequest(paymentCode);
      setSuccessMessage('Payment request deleted');
      loadActiveRequests();
    } catch (err) {
      setError('Failed to delete request');
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={handleCloseModal}
    >
      <div
        className="glass-card p-6 w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <ArrowDownLeft className="w-5 h-5 text-cyan-400" />
            Receive Money
          </h3>
          <button
            onClick={handleCloseModal}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step 1: Generate Form (for Receive) */}
        {step === 'form' && (
          <form onSubmit={handleGenerateQR} className="space-y-4">
            <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-3">
              <p className="text-cyan-400 text-xs font-semibold">📌 RECEIVE MONEY</p>
              <p className="text-gray-300 text-sm mt-1">Enter amount for others to pay you</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Amount ({selectedCurrency})
              </label>
              <input
                type="number"
                placeholder="1000"
                step="0.01"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:border-cyan-400 focus:outline-none transition-all"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Description (Optional)
              </label>
              <input
                type="text"
                placeholder="Invoice #123 - Product delivery"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:border-cyan-400 focus:outline-none transition-all"
              />
              <p className="text-xs text-gray-500 mt-1">
                Help the payer understand what this payment is for
              </p>
            </div>

            {error && (
              <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg">
                <p className="text-sm text-red-400">❌ {error}</p>
              </div>
            )}

            {successMessage && (
              <div className="p-3 bg-green-500/20 border border-green-500/50 rounded-lg">
                <p className="text-sm text-green-400">✅ {successMessage}</p>
              </div>
            )}

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={handleCloseModal}
                className="flex-1 px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 px-4 py-2 bg-gradient-to-r from-cyan-500 to-cyan-600 text-white rounded-lg hover:shadow-lg hover:shadow-cyan-500/30 disabled:opacity-50 transition-all font-semibold flex items-center justify-center gap-2"
              >
                {loading && <Loader className="w-4 h-4 animate-spin" />}
                {loading ? 'Generating...' : '🔗 Generate QR Code'}
              </button>
            </div>
          </form>
        )}

        {/* Step 3: QR Code Display */}
        {step === 'qrcode' && qrData && (
          <div className="space-y-4">
            {/* QR Code */}
            <div className="flex justify-center p-4 bg-white/10 rounded-lg">
              <QRCode
                id="qr-code-download"
                value={paymentLink}
                size={256}
                level="H"
                includeMargin={true}
              />
            </div>

            {/* Payment Details */}
            <div className="bg-white/10 rounded-lg p-4 space-y-2">
              <div className="text-center">
                <p className="text-sm text-gray-400">Payment Amount</p>
                <p className="text-2xl font-bold text-cyan-400">
                  {qrData.amount} {qrData.currency}
                </p>
              </div>
              {qrData.description && (
                <div className="text-center">
                  <p className="text-sm text-gray-400">For</p>
                  <p className="text-white font-medium">{qrData.description}</p>
                </div>
              )}
              <div className="text-center text-xs text-gray-500 pt-2 border-t border-white/20">
                <p>Code: {qrData.payment_code}</p>
              </div>
            </div>

            {/* Payment Link */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-300">Payment Link</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={paymentLink}
                  readOnly
                  className="flex-1 px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white text-xs truncate"
                />
                <button
                  onClick={handleCopyLink}
                  className="px-3 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/50 rounded-lg text-cyan-400 transition-all"
                  title="Copy link"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Sharing Options */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleDownloadQR}
                className="px-3 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg text-white text-sm font-medium transition-all flex items-center justify-center gap-1"
              >
                <Download className="w-4 h-4" />
                Download QR
              </button>
              <button
                onClick={() => {
                  // Share via WhatsApp, copy, etc
                  const text = `Pay me ${qrData.amount} ${qrData.currency}${qrData.description ? ` for ${qrData.description}` : ''}. Tap to pay: ${paymentLink}`;
                  if (navigator.share) {
                    navigator.share({ title: 'Payment Request', text });
                  }
                }}
                className="px-3 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/50 rounded-lg text-cyan-400 text-sm font-medium transition-all"
              >
                📤 Share
              </button>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                onClick={() => setStep('form')}
                className="flex-1 px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-all"
              >
                Back
              </button>
              <button
                onClick={() => setStep('active')}
                className="flex-1 px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-all"
              >
                View Active
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Active Requests */}
        {step === 'active' && (
          <div className="space-y-4">
            <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-3">
              <p className="text-cyan-400 text-xs font-semibold">📋 ACTIVE REQUESTS</p>
              <p className="text-gray-300 text-sm mt-1">Your pending payment requests</p>
            </div>

            {activeRequests.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-400">No active payment requests</p>
                <button
                  onClick={() => setStep('form')}
                  className="mt-4 px-4 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/50 rounded-lg text-cyan-400 text-sm"
                >
                  Create New
                </button>
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {activeRequests.map((req) => (
                  <div
                    key={req.id}
                    className="p-3 bg-white/10 border border-white/20 rounded-lg"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-semibold text-white">
                          {req.amount} {req.currency}
                        </p>
                        {req.description && (
                          <p className="text-xs text-gray-400">{req.description}</p>
                        )}
                      </div>
                      <span className="text-xs bg-cyan-500/20 text-cyan-400 px-2 py-1 rounded">
                        {req.status}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mb-2">
                      Expires: {new Date(req.expires_at).toLocaleString()}
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(req.payment_code);
                          setSuccessMessage('Code copied!');
                          setTimeout(() => setSuccessMessage(null), 2000);
                        }}
                        className="flex-1 px-2 py-1 bg-white/10 hover:bg-white/20 text-white text-xs rounded transition-all"
                      >
                        Copy Code
                      </button>
                      <button
                        onClick={() => handleDeleteRequest(req.payment_code)}
                        className="flex-1 px-2 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-xs rounded transition-all"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {successMessage && (
              <div className="p-3 bg-green-500/20 border border-green-500/50 rounded-lg">
                <p className="text-sm text-green-400">✅ {successMessage}</p>
              </div>
            )}

            <div className="flex gap-3 pt-4">
              <button
                onClick={() => setStep('form')}
                className="flex-1 px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-all"
              >
                New Request
              </button>
              <button
                onClick={() => setStep('form')}
                className="flex-1 px-4 py-2 bg-gradient-to-r from-cyan-500 to-cyan-600 text-white rounded-lg hover:shadow-lg hover:shadow-cyan-500/30 transition-all font-semibold"
              >
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReceiveMoneyModal;
