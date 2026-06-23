import { Bike, MapPin, DollarSign, Users, Shield, TrendingUp } from 'lucide-react';

interface LandingPageProps {
  onGetStarted: () => void;
}

export default function LandingPage({ onGetStarted }: LandingPageProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-orange-100">
      {/* Header */}
      <header className="container mx-auto px-4 py-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-yellow-500 rounded-xl flex items-center justify-center shadow-lg">
              <Bike size={24} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">My Boda Guy</h1>
              <p className="text-sm text-slate-600">Your Trusted Ride Partner</p>
            </div>
          </div>
          <button
            onClick={onGetStarted}
            className="px-6 py-2 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-yellow-600 transition-all shadow-lg"
          >
            Get Started
          </button>
        </div>
      </header>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-20 text-center">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-5xl md:text-6xl font-bold text-slate-800 mb-6">
            Ride Smart, Earn More
          </h2>
          <p className="text-xl text-slate-600 mb-8 max-w-2xl mx-auto">
            The complete boda boda management system with fair commission distribution 
            and hierarchical leadership structure for Uganda's transport sector
          </p>
          <button
            onClick={onGetStarted}
            className="px-8 py-4 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-bold text-lg rounded-xl hover:from-orange-600 hover:to-yellow-600 transition-all shadow-2xl"
          >
            Join My Boda Guy Today
          </button>
        </div>
      </section>

      {/* Features */}
      <section className="container mx-auto px-4 py-16">
        <h3 className="text-3xl font-bold text-center text-slate-800 mb-12">
          Why Choose My Boda Guy?
        </h3>
        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          <FeatureCard
            icon={<MapPin className="text-orange-500" size={32} />}
            title="Real-time Tracking"
            description="Track your ride in real-time with GPS navigation and live updates"
          />
          <FeatureCard
            icon={<DollarSign className="text-orange-500" size={32} />}
            title="Fair Commissions"
            description="Transparent commission structure with automatic distribution to chairpersons"
          />
          <FeatureCard
            icon={<Users className="text-orange-500" size={32} />}
            title="Organized System"
            description="Hierarchical structure from District to Stage level for better management"
          />
          <FeatureCard
            icon={<Shield className="text-orange-500" size={32} />}
            title="Secure Payments"
            description="Multiple payment options including mobile money and cash"
          />
          <FeatureCard
            icon={<TrendingUp className="text-orange-500" size={32} />}
            title="Earnings Analytics"
            description="Track your earnings, commissions, and performance metrics"
          />
          <FeatureCard
            icon={<Bike className="text-orange-500" size={32} />}
            title="For Everyone"
            description="Customers, Riders, and Chairpersons all benefit from the platform"
          />
        </div>
      </section>

      {/* How It Works */}
      <section className="container mx-auto px-4 py-16">
        <h3 className="text-3xl font-bold text-center text-slate-800 mb-12">
          How It Works
        </h3>
        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          <StepCard
            number="1"
            title="Sign Up"
            description="Create your account as a customer, rider, or chairperson"
          />
          <StepCard
            number="2"
            title="Get Verified"
            description="Riders get approved by stage chairpersons, chairpersons by higher levels"
          />
          <StepCard
            number="3"
            title="Start Earning"
            description="Request rides, accept bookings, or earn commissions from your region"
          />
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-4 py-20 text-center">
        <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-2xl p-12">
          <h3 className="text-4xl font-bold text-slate-800 mb-4">
            Ready to Get Started?
          </h3>
          <p className="text-xl text-slate-600 mb-8">
            Join thousands of riders and customers using My Boda Guy every day
          </p>
          <button
            onClick={onGetStarted}
            className="px-8 py-4 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-bold text-lg rounded-xl hover:from-orange-600 hover:to-yellow-600 transition-all shadow-lg"
          >
            Sign Up Now - It's Free!
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="container mx-auto px-4 py-8 border-t border-slate-200">
        <div className="text-center text-slate-600">
          <p>&copy; 2026 My Boda Guy. All rights reserved.</p>
          <p className="text-sm mt-2">Your Trusted Ride Partner in Uganda</p>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="bg-white rounded-xl p-6 shadow-lg hover:shadow-xl transition-all">
      <div className="mb-4">{icon}</div>
      <h4 className="text-xl font-bold text-slate-800 mb-2">{title}</h4>
      <p className="text-slate-600">{description}</p>
    </div>
  );
}

function StepCard({ number, title, description }: { number: string; title: string; description: string }) {
  return (
    <div className="bg-white rounded-xl p-6 shadow-lg text-center">
      <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-yellow-500 rounded-full flex items-center justify-center mx-auto mb-4 text-white font-bold text-xl">
        {number}
      </div>
      <h4 className="text-xl font-bold text-slate-800 mb-2">{title}</h4>
      <p className="text-slate-600">{description}</p>
    </div>
  );
}
