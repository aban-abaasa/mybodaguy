import { useState } from 'react';
import { Crown, DollarSign, Home, TrendingUp, TrendingDown, Info, Tag } from 'lucide-react';
import { toast } from 'sonner';

type RiderMode = 'normal' | 'vip' | 'discount' | 'return';

interface RiderModeSelectorProps {
  riderId: string;
  currentMode?: RiderMode;
  onModeChange?: (mode: RiderMode, vipSurcharge?: number, discountRate?: number, returnDiscount?: number) => void;
}

export default function RiderModeSelector({ riderId, currentMode = 'normal', onModeChange }: RiderModeSelectorProps) {
  const [selectedMode, setSelectedMode] = useState<RiderMode>(currentMode);
  const [vipSurcharge, setVipSurcharge] = useState(10); // 0-20% extra for VIP
  const [discountRate, setDiscountRate] = useState(10); // 0-30% discount to attract customers
  const [returnDiscount, setReturnDiscount] = useState(30); // 0-50% discount when going home
  const [loading, setLoading] = useState(false);

  const modes = [
    {
      id: 'normal' as RiderMode,
      name: 'Normal',
      icon: DollarSign,
      color: 'slate',
      priceChange: '0%',
      shortDesc: 'Standard pricing',
    },
    {
      id: 'vip' as RiderMode,
      name: 'VIP',
      icon: Crown,
      color: 'purple',
      priceChange: `+${vipSurcharge}%`,
      shortDesc: 'Premium service',
    },
    {
      id: 'discount' as RiderMode,
      name: 'Discount',
      icon: Tag,
      color: 'orange',
      priceChange: `-${discountRate}%`,
      shortDesc: 'Attract customers',
    },
    {
      id: 'return' as RiderMode,
      name: 'Return',
      icon: Home,
      color: 'green',
      priceChange: `-${returnDiscount}%`,
      shortDesc: 'Going home',
    }
  ];

  const handleModeChange = async (mode: RiderMode) => {
    if (mode === selectedMode) return;

    setLoading(true);
    try {
      // TODO: Implement API call to update rider mode
      await new Promise(resolve => setTimeout(resolve, 500));
      
      setSelectedMode(mode);
      onModeChange?.(mode, vipSurcharge, discountRate, returnDiscount);
      toast.success(`Switched to ${modes.find(m => m.id === mode)?.name} mode`);
    } catch (error) {
      toast.error('Failed to change mode');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-lg p-3 sm:p-4 md:p-6">
      <div className="mb-3 sm:mb-4 md:mb-6">
        <h3 className="text-base sm:text-lg md:text-xl font-bold text-slate-800 mb-0.5 sm:mb-1">Work Mode</h3>
        <p className="text-[10px] xs:text-xs sm:text-sm text-slate-600">Choose your pricing strategy</p>
      </div>

      {/* Mode Selection - Mobile Optimized: Single Row with Scroll */}
      <div className="flex gap-1.5 xs:gap-2 mb-3 sm:mb-4 md:mb-6 overflow-x-auto pb-2 scrollbar-hide">
        {modes.map((mode) => {
          const Icon = mode.icon;
          const isSelected = selectedMode === mode.id;
          
          return (
            <button
              key={mode.id}
              onClick={() => handleModeChange(mode.id)}
              disabled={loading}
              className={`relative flex-shrink-0 w-[75px] xs:w-[85px] sm:w-[100px] md:w-[110px] p-2 xs:p-2.5 sm:p-3 rounded-lg border-2 transition-all ${
                isSelected
                  ? `border-${mode.color}-500 bg-gradient-to-br from-${mode.color}-50 to-${mode.color}-100 shadow-md`
                  : 'border-slate-200 bg-white hover:border-slate-300'
              } ${loading ? 'opacity-50' : ''}`}
            >
              {/* Selected indicator */}
              {isSelected && (
                <div className={`absolute top-0.5 xs:top-1 right-0.5 xs:right-1 w-3 xs:w-3.5 sm:w-4 h-3 xs:h-3.5 sm:h-4 bg-${mode.color}-500 rounded-full flex items-center justify-center`}>
                  <svg className="w-1.5 xs:w-2 sm:w-2.5 h-1.5 xs:h-2 sm:h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
              )}

              {/* Icon */}
              <div className={`w-6 xs:w-7 sm:w-8 h-6 xs:h-7 sm:h-8 rounded-full flex items-center justify-center mb-1 xs:mb-1.5 mx-auto ${
                isSelected ? `bg-${mode.color}-500` : `bg-${mode.color}-100`
              }`}>
                <Icon size={12} className={`xs:w-[14px] xs:h-[14px] sm:w-4 sm:h-4 ${isSelected ? 'text-white' : `text-${mode.color}-600`}`} />
              </div>

              {/* Mode name */}
              <h4 className="font-bold text-[10px] xs:text-[11px] sm:text-xs text-slate-800 mb-0.5 text-center truncate">{mode.name}</h4>
              
              {/* Price badge */}
              <div className={`inline-flex items-center justify-center gap-0.5 px-0.5 xs:px-1 py-0.5 rounded-full text-[8px] xs:text-[9px] sm:text-[10px] font-semibold w-full ${
                mode.id === 'vip' ? 'bg-green-100 text-green-700' :
                mode.id === 'discount' || mode.id === 'return' ? 'bg-red-100 text-red-700' :
                'bg-slate-100 text-slate-700'
              }`}>
                {mode.id === 'vip' ? <TrendingUp size={8} className="xs:w-[9px] xs:h-[9px] sm:w-2.5 sm:h-2.5" /> : 
                 (mode.id === 'discount' || mode.id === 'return') ? <TrendingDown size={8} className="xs:w-[9px] xs:h-[9px] sm:w-2.5 sm:h-2.5" /> : 
                 null}
                <span className="truncate">{mode.priceChange}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* VIP Surcharge Selector */}
      {selectedMode === 'vip' && (
        <div className="mb-3 sm:mb-4 md:mb-6 p-2.5 xs:p-3 sm:p-4 bg-purple-50 border border-purple-200 rounded-lg">
          <div className="flex items-center justify-between mb-1.5 sm:mb-2">
            <label className="text-xs xs:text-sm font-semibold text-purple-900">Your Premium Rate</label>
            <span className="text-lg xs:text-xl sm:text-2xl font-bold text-purple-600">+{vipSurcharge}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="20"
            step="1"
            value={vipSurcharge}
            onChange={(e) => setVipSurcharge(Number(e.target.value))}
            className="w-full h-1.5 xs:h-2 bg-purple-200 rounded-lg appearance-none cursor-pointer accent-purple-500"
          />
          <div className="flex justify-between text-[9px] xs:text-xs text-purple-700 mt-0.5 xs:mt-1">
            <span>0%</span>
            <span>10%</span>
            <span>20%</span>
          </div>
          <p className="text-[10px] xs:text-xs text-purple-600 mt-1.5 xs:mt-2">
            💰 Customers pay {vipSurcharge}% more • You earn extra UGX {(5000 * vipSurcharge / 100).toFixed(0)} per 5km ride
          </p>
        </div>
      )}

      {/* Discount Rate Selector - NEW MODE */}
      {selectedMode === 'discount' && (
        <div className="mb-3 sm:mb-4 md:mb-6 p-2.5 xs:p-3 sm:p-4 bg-orange-50 border border-orange-200 rounded-lg">
          <div className="flex items-center justify-between mb-1.5 sm:mb-2">
            <label className="text-xs xs:text-sm font-semibold text-orange-900">Your Discount Offer</label>
            <span className="text-lg xs:text-xl sm:text-2xl font-bold text-orange-600">-{discountRate}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="30"
            step="5"
            value={discountRate}
            onChange={(e) => setDiscountRate(Number(e.target.value))}
            className="w-full h-1.5 xs:h-2 bg-orange-200 rounded-lg appearance-none cursor-pointer accent-orange-500"
          />
          <div className="flex justify-between text-[9px] xs:text-xs text-orange-700 mt-0.5 xs:mt-1">
            <span>0%</span>
            <span>15%</span>
            <span>30%</span>
          </div>
          <p className="text-[10px] xs:text-xs text-orange-600 mt-1.5 xs:mt-2">
            🎯 Attract more customers! • They save {discountRate}% • You earn UGX {(5000 * (100 - discountRate) / 100).toFixed(0)} per 5km
          </p>
          <div className="mt-1.5 xs:mt-2 p-1.5 xs:p-2 bg-orange-100 rounded text-[9px] xs:text-xs text-orange-800">
            <strong>Strategy:</strong> Higher discounts = More ride requests. Great for slow hours!
          </div>
        </div>
      )}

      {/* Return Discount Selector */}
      {selectedMode === 'return' && (
        <div className="mb-3 sm:mb-4 md:mb-6 p-2.5 xs:p-3 sm:p-4 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center justify-between mb-1.5 sm:mb-2">
            <label className="text-xs xs:text-sm font-semibold text-green-900">Going Home Discount</label>
            <span className="text-lg xs:text-xl sm:text-2xl font-bold text-green-600">-{returnDiscount}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="50"
            step="5"
            value={returnDiscount}
            onChange={(e) => setReturnDiscount(Number(e.target.value))}
            className="w-full h-1.5 xs:h-2 bg-green-200 rounded-lg appearance-none cursor-pointer accent-green-500"
          />
          <div className="flex justify-between text-[9px] xs:text-xs text-green-700 mt-0.5 xs:mt-1">
            <span>0%</span>
            <span>25%</span>
            <span>50%</span>
          </div>
          <p className="text-[10px] xs:text-xs text-green-600 mt-1.5 xs:mt-2">
            🏠 Going home anyway • Customers save {returnDiscount}% • You earn UGX {(5000 * (100 - returnDiscount) / 100).toFixed(0)} per 5km
          </p>
        </div>
      )}

      {/* Current Mode Info - Compact */}
      <div className={`p-2.5 xs:p-3 sm:p-4 rounded-lg border-2 ${
        selectedMode === 'vip' ? 'border-purple-200 bg-purple-50' :
        selectedMode === 'discount' ? 'border-orange-200 bg-orange-50' :
        selectedMode === 'return' ? 'border-green-200 bg-green-50' :
        'border-slate-200 bg-slate-50'
      }`}>
        <div className="flex items-start gap-1.5 xs:gap-2 sm:gap-3">
          <Info className={`flex-shrink-0 w-3.5 xs:w-4 sm:w-5 h-3.5 xs:h-4 sm:h-5 ${
            selectedMode === 'vip' ? 'text-purple-500' :
            selectedMode === 'discount' ? 'text-orange-500' :
            selectedMode === 'return' ? 'text-green-500' :
            'text-slate-500'
          }`} />
          <div className="flex-1">
            <h5 className="font-semibold text-[10px] xs:text-xs sm:text-sm text-slate-800 mb-0.5 xs:mb-1">
              {selectedMode === 'vip' && `VIP Mode: +${vipSurcharge}% Premium`}
              {selectedMode === 'discount' && `Discount Mode: -${discountRate}% Off`}
              {selectedMode === 'return' && `Return Home: -${returnDiscount}% Off`}
              {selectedMode === 'normal' && 'Normal Mode Active'}
            </h5>
            <p className="text-[9px] xs:text-xs text-slate-600 leading-tight xs:leading-normal">
              {selectedMode === 'vip' && `Customers pay ${vipSurcharge}% more for premium service. Perfect for peak hours!`}
              {selectedMode === 'discount' && `Offer ${discountRate}% discount to attract more customers. Great for building your reputation or slow hours!`}
              {selectedMode === 'return' && `Customers save ${returnDiscount}% on rides going your way. Get paid while heading home!`}
              {selectedMode === 'normal' && 'Standard pricing with balanced ride distribution.'}
            </p>
          </div>
        </div>
      </div>

      {/* Tips - Compact */}
      <div className="mt-2.5 xs:mt-3 sm:mt-4 p-2 xs:p-2.5 sm:p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-[9px] xs:text-xs text-blue-800 leading-tight xs:leading-normal">
          <strong>💡 Smart Tips:</strong> VIP for peak hours • Discount for slow hours • Return when heading home!
        </p>
      </div>
    </div>
  );
}
