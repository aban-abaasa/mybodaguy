import { useState } from 'react';
import { Crown, DollarSign, Home, TrendingUp, TrendingDown, Info } from 'lucide-react';
import { toast } from 'sonner';

type RiderMode = 'normal' | 'vip' | 'return';

interface RiderModeSelectorProps {
  riderId: string;
  currentMode?: RiderMode;
  onModeChange?: (mode: RiderMode) => void;
}

export default function RiderModeSelector({ riderId, currentMode = 'normal', onModeChange }: RiderModeSelectorProps) {
  const [selectedMode, setSelectedMode] = useState<RiderMode>(currentMode);
  const [loading, setLoading] = useState(false);

  const modes = [
    {
      id: 'normal' as RiderMode,
      name: 'Normal Mode',
      icon: DollarSign,
      color: 'slate',
      priceChange: '0%',
      description: 'Standard pricing for all rides',
      benefits: [
        'Regular earnings',
        'Balanced ride requests',
        'Standard commission rate'
      ]
    },
    {
      id: 'vip' as RiderMode,
      name: 'VIP Mode',
      icon: Crown,
      color: 'purple',
      priceChange: '+20%',
      description: 'Premium service with higher earnings',
      benefits: [
        'Earn 20% more per ride',
        'Priority for high-value customers',
        'Premium service badge'
      ]
    },
    {
      id: 'return' as RiderMode,
      name: 'Return Home Mode',
      icon: Home,
      color: 'green',
      priceChange: 'up to -50%',
      description: 'Discounted rides heading towards your home',
      benefits: [
        'Get paid while going home',
        'Customers save up to 50%',
        'More ride opportunities'
      ]
    }
  ];

  const handleModeChange = async (mode: RiderMode) => {
    if (mode === selectedMode) return;

    setLoading(true);
    try {
      // TODO: Implement API call to update rider mode
      await new Promise(resolve => setTimeout(resolve, 500)); // Simulate API call
      
      setSelectedMode(mode);
      onModeChange?.(mode);
      toast.success(`Switched to ${modes.find(m => m.id === mode)?.name}`);
    } catch (error) {
      toast.error('Failed to change mode');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-lg p-6">
      <div className="mb-6">
        <h3 className="text-xl font-bold text-slate-800 mb-2">Work Mode</h3>
        <p className="text-sm text-slate-600">Choose how you want to work today</p>
      </div>

      <div className="grid md:grid-cols-3 gap-4 mb-6">
        {modes.map((mode) => {
          const Icon = mode.icon;
          const isSelected = selectedMode === mode.id;
          
          return (
            <button
              key={mode.id}
              onClick={() => handleModeChange(mode.id)}
              disabled={loading}
              className={`relative p-6 rounded-xl border-2 transition-all text-left ${
                isSelected
                  ? `border-${mode.color}-500 bg-gradient-to-br from-${mode.color}-50 to-${mode.color}-100 shadow-lg`
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-md'
              } ${loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              {isSelected && (
                <div className={`absolute top-3 right-3 w-6 h-6 bg-${mode.color}-500 rounded-full flex items-center justify-center`}>
                  <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
              )}

              <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 ${
                isSelected ? `bg-${mode.color}-500` : `bg-${mode.color}-100`
              }`}>
                <Icon size={24} className={isSelected ? 'text-white' : `text-${mode.color}-600`} />
              </div>

              <h4 className="font-bold text-slate-800 mb-1">{mode.name}</h4>
              <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold mb-3 ${
                mode.id === 'vip' ? 'bg-green-100 text-green-700' :
                mode.id === 'return' ? 'bg-red-100 text-red-700' :
                'bg-slate-100 text-slate-700'
              }`}>
                {mode.id === 'vip' ? <TrendingUp size={12} /> : 
                 mode.id === 'return' ? <TrendingDown size={12} /> : 
                 null}
                {mode.priceChange}
              </div>
              <p className="text-sm text-slate-600 mb-3">{mode.description}</p>
              
              <ul className="space-y-1">
                {mode.benefits.map((benefit, idx) => (
                  <li key={idx} className="text-xs text-slate-600 flex items-start gap-2">
                    <span className="text-green-500 mt-0.5">✓</span>
                    <span>{benefit}</span>
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      {/* Current Mode Info */}
      <div className={`p-4 rounded-lg border-2 ${
        selectedMode === 'vip' ? 'border-purple-200 bg-purple-50' :
        selectedMode === 'return' ? 'border-green-200 bg-green-50' :
        'border-slate-200 bg-slate-50'
      }`}>
        <div className="flex items-start gap-3">
          <Info className={`flex-shrink-0 ${
            selectedMode === 'vip' ? 'text-purple-500' :
            selectedMode === 'return' ? 'text-green-500' :
            'text-slate-500'
          }`} size={20} />
          <div className="flex-1">
            <h5 className="font-semibold text-slate-800 mb-1">
              {selectedMode === 'vip' && 'VIP Mode Active'}
              {selectedMode === 'return' && 'Return Home Mode Active'}
              {selectedMode === 'normal' && 'Normal Mode Active'}
            </h5>
            <p className="text-sm text-slate-600">
              {selectedMode === 'vip' && 'You\'ll earn 20% more per ride. Customers looking for premium service will see you first.'}
              {selectedMode === 'return' && 'You\'ll get ride requests heading towards your home base. Customers pay less, you get paid while going home!'}
              {selectedMode === 'normal' && 'You\'re in standard mode with regular pricing and balanced ride distribution.'}
            </p>
          </div>
        </div>
      </div>

      {/* Mode Switch Tips */}
      <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm text-blue-800">
          <strong>Pro Tip:</strong> Switch to VIP mode during peak hours for maximum earnings. 
          Use Return mode at the end of your shift to get paid while heading home!
        </p>
      </div>
    </div>
  );
}
