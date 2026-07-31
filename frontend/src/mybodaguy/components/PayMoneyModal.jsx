/**
 * Pay Money Modal Component
 * Scans QR codes for payments
 */

import React, { useState, useEffect, useRef } from 'react';
import { ArrowUpRight, X, Loader } from 'lucide-react';
import jsQR from 'jsqr';
import { supabase } from '../../services/supabaseClient';

const PayMoneyModal = ({ 
  isOpen, 
  onClose, 
  onPaymentScanned = null,
  userId = null
}) => {
  console.log('PayMoneyModal rendered, isOpen:', isOpen);
  
  const [cameraActive, setCameraActive] = useState(false);
  const [scannedData, setScannedData] = useState('');
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [scanBuffer, setScanBuffer] = useState('');
  const [paymentPurpose, setPaymentPurpose] = useState('personal');
  const [businessProfiles, setBusinessProfiles] = useState([]);
  const [businessProfileId, setBusinessProfileId] = useState('');
  const [loadingBusinesses, setLoadingBusinesses] = useState(false);
  
  // Refs for scanner
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const gunInputRef = useRef(null);
  const lastProcessedBarcodeRef = useRef(null);

  const resetModalState = () => {
    setScannedData('');
    setError(null);
    setSuccessMessage(null);
    setScanBuffer('');
    setPaymentPurpose('personal');
    setBusinessProfiles([]);
    setBusinessProfileId('');
    
    // Stop camera if active
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
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
    if (!isOpen || paymentPurpose !== 'business' || !userId) return undefined;
    let cancelled = false;
    setLoadingBusinesses(true);
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        const [owned, memberships, coOwned] = await Promise.all([
          supabase.from('business_profiles').select('id, business_name').eq('user_id', userId),
          supabase.from('business_team_members').select('business_profile_id').eq('user_id', userId).eq('status', 'active'),
          supabase.from('business_co_owners').select('business_profile_id').or(`user_id.eq.${userId},owner_email.eq.${user?.email || ''}`),
        ]);
        const ids = [...new Set([
          ...(owned.data || []).map(profile => profile.id),
          ...(memberships.data || []).map(member => member.business_profile_id),
          ...(coOwned.data || []).map(member => member.business_profile_id),
        ])];
        const profiles = ids.length ? (await supabase.from('business_profiles').select('id, business_name').in('id', ids)).data || [] : [];
        if (!cancelled) {
          setBusinessProfiles(profiles);
          setBusinessProfileId(prev => prev || (profiles.length === 1 ? profiles[0].id : ''));
        }
      } catch (error) {
        console.error('Unable to load businesses for payment:', error);
      } finally {
        if (!cancelled) setLoadingBusinesses(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, paymentPurpose, userId]);

  useEffect(() => {
    if (!isOpen) {
      resetModalState();
    }
  }, [isOpen]);

  // Initialize camera when modal opens
  useEffect(() => {
    if (isOpen && !cameraActive) {
      initializeCamera();
    }
    
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        setCameraActive(false);
      }
    };
  }, [isOpen]);

  // Initialize gun scanner
  useEffect(() => {
    if (isOpen && gunInputRef.current) {
      initializeGunScanner();
      gunInputRef.current.addEventListener('keydown', handleGunInput);
      
      return () => {
        if (gunInputRef.current) {
          gunInputRef.current.removeEventListener('keydown', handleGunInput);
        }
      };
    }
  }, [isOpen, scanBuffer]);

  const initializeCamera = async () => {
    try {
      if (!videoRef.current) {
        console.error('❌ Video element not ready');
        setError('Camera element not ready');
        return;
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera API not supported on this device');
      }

      console.log('📸 Requesting camera permissions...');
      
      let stream = null;
      
      try {
        stream = await Promise.race([
          navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1280, min: 480 },
              height: { ideal: 720, min: 320 }
            },
            audio: false
          }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), 3000)
          )
        ]);
      } catch (error) {
        console.warn('⚠️ Full HD constraints failed, trying basic...');
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false
        });
      }
      
      if (!stream || !stream.active) {
        throw new Error('Failed to get active camera stream');
      }

      console.log('✅ Camera stream obtained');
      
      const video = videoRef.current;
      video.playsInline = true;
      video.muted = true;
      video.srcObject = stream;
      streamRef.current = stream;
      
      video.addEventListener('loadedmetadata', () => {
        video.play()
          .then(() => {
            console.log('✅ Video playback started');
            setCameraActive(true);
            startBarcodeDetection();
          })
          .catch(err => {
            console.error('❌ Video play error:', err);
            setError('Failed to play video: ' + err.message);
            setCameraActive(false);
          });
      });
      
    } catch (error) {
      console.error('📸 Camera Error:', error);
      
      if (error.name === 'NotAllowedError') {
        setError('Camera permission denied');
      } else if (error.name === 'NotFoundError') {
        setError('No camera found');
      } else {
        setError('Camera error: ' + (error.message || 'Unknown'));
      }
      
      setCameraActive(false);
    }
  };

  const startBarcodeDetection = () => {
    if (!canvasRef.current || !videoRef.current) {
      console.error('❌ Canvas or Video reference missing');
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      console.error('❌ Cannot get canvas context');
      return;
    }
    
    const video = videoRef.current;
    let isDetecting = true;

    console.log('🎬 Starting QR code detection...');

    const detectFrame = async () => {
      try {
        if (video.readyState >= 2) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          let imageData;
          try {
            imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          } catch (err) {
            if (isDetecting) {
              requestAnimationFrame(detectFrame);
            }
            return;
          }
          
          try {
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: "dontInvert",
            });
            
            if (code && code.data && code.data.trim()) {
              const detectedQRCode = code.data.trim();
              
              if (lastProcessedBarcodeRef.current !== detectedQRCode) {
                console.log('✅ QR Code Detected:', detectedQRCode);
                lastProcessedBarcodeRef.current = detectedQRCode;
                
                // Visual feedback
                ctx.strokeStyle = '#00ff00';
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.moveTo(code.location.topLeftCorner.x, code.location.topLeftCorner.y);
                ctx.lineTo(code.location.topRightCorner.x, code.location.topRightCorner.y);
                ctx.lineTo(code.location.bottomRightCorner.x, code.location.bottomRightCorner.y);
                ctx.lineTo(code.location.bottomLeftCorner.x, code.location.bottomLeftCorner.y);
                ctx.lineTo(code.location.topLeftCorner.x, code.location.topLeftCorner.y);
                ctx.stroke();
                
                handleScannedCode(detectedQRCode);
                
                isDetecting = false;
                return;
              }
            }
          } catch (e) {
            console.warn('⚠️ jsQR detection error:', e.message);
          }
        }
      } catch (error) {
        console.error('Frame detection error:', error);
      }

      if (isDetecting) {
        requestAnimationFrame(detectFrame);
      }
    };

    detectFrame();
  };

  const handleScannedCode = (code) => {
    console.log('📱 Processing scanned code:', code);
    setScannedData(code);
    setSuccessMessage('✅ QR Code scanned!');
    
    // Stop camera
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
    
    // Wait for the payer to classify the expense before submitting it.
  };

  const submitPayment = async () => {
    if (!onPaymentScanned || !scannedData.trim()) return;
    if (paymentPurpose === 'business' && businessProfiles.length > 1 && !businessProfileId) return;
    await onPaymentScanned(scannedData.trim(), paymentPurpose, businessProfileId || null);
  };

  const initializeGunScanner = () => {
    if (gunInputRef.current) {
      gunInputRef.current.focus();
    }
  };

  const handleGunInput = (e) => {
    if (e.key === 'Enter') {
      if (scanBuffer.trim()) {
        handleScannedCode(scanBuffer.trim());
        setScanBuffer('');
      }
    } else if (e.key.length === 1) {
      setScanBuffer(prev => prev + e.key);
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
            <ArrowUpRight className="w-5 h-5 text-orange-400" />
            Pay
          </h3>
          <button
            onClick={handleCloseModal}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Camera View */}
          <div className="relative bg-black rounded-lg overflow-hidden" style={{ aspectRatio: '4/3' }}>
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              playsInline
              muted
            />
            <canvas ref={canvasRef} className="hidden" />
            
            {/* Scanning Overlay */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-64 h-64 border-4 border-orange-400 rounded-lg animate-pulse">
                <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-orange-400"></div>
                <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-orange-400"></div>
                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-orange-400"></div>
                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-orange-400"></div>
              </div>
            </div>

            {/* Status Indicator */}
            {!cameraActive && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                <Loader className="w-12 h-12 text-orange-400 animate-spin" />
              </div>
            )}
          </div>

          {/* Hidden input for gun scanner */}
          <input
            ref={gunInputRef}
            type="text"
            className="sr-only"
            autoFocus
            value={scanBuffer}
            onChange={(e) => setScanBuffer(e.target.value)}
          />

          {/* OR Divider */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-white/20"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-gray-800 text-gray-400">OR</span>
            </div>
          </div>

          {/* Manual Code Input */}
          <div>
            <input
              type="text"
              placeholder="Enter payment code"
              value={scannedData}
              onChange={(e) => setScannedData(e.target.value)}
              className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:border-orange-400 focus:outline-none transition-all text-center font-mono"
            />
          </div>

          {error && (
            <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {successMessage && (
            <div className="p-3 bg-green-500/20 border border-green-500/50 rounded-lg">
              <p className="text-sm text-green-400">{successMessage}</p>
            </div>
          )}

          {scannedData.trim() && (
            <div className="rounded-lg border border-white/10 bg-white/5 p-3">
              <p className="text-xs text-gray-400 mb-2">Record this payment in ICANera as</p>
              <div className="grid grid-cols-2 gap-2">
                {[{ value: 'business', label: '💼 Business' }, { value: 'personal', label: '👤 Personal' }].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setPaymentPurpose(option.value)}
                    className={`px-3 py-2 rounded-lg text-sm font-semibold ${paymentPurpose === option.value ? 'bg-orange-500 text-white' : 'bg-white/10 text-gray-300'}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {paymentPurpose === 'business' && scannedData.trim() && (
            <div className="rounded-lg border border-blue-400/30 bg-blue-500/10 p-3">
              <p className="text-xs text-blue-200 mb-2">Choose the business for this report</p>
              {loadingBusinesses ? <p className="text-xs text-gray-300">Loading your businesses…</p> : businessProfiles.length > 1 ? (
                <select value={businessProfileId} onChange={e => setBusinessProfileId(e.target.value)} className="w-full rounded-lg bg-gray-800 border border-blue-300/40 px-3 py-2 text-sm text-white">
                  <option value="">Select a business…</option>
                  {businessProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.business_name}</option>)}
                </select>
              ) : businessProfiles.length === 1 ? <p className="text-sm text-blue-100">{businessProfiles[0].business_name}</p> : <p className="text-xs text-amber-200">No business profile found; this will still be recorded as a business expense.</p>}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleCloseModal}
              className="flex-1 px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-all"
            >
              ✕
            </button>
            {scannedData.trim() && (
              <button
                onClick={() => {
                  submitPayment();
                }}
                className="flex-1 px-4 py-2 bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-lg hover:shadow-lg transition-all font-semibold"
              >
                Pay
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PayMoneyModal;
