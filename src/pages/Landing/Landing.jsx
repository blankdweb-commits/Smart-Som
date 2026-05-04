import React from 'react';
import HeroSection from './components/HeroSection';
import StudentGallery from './components/StudentGallery';
import Testimonials from './components/Testimonials';
import ValueStack from './components/ValueStack';
import Pricing from './components/Pricing';
import DashboardPreview from './components/DashboardPreview';
import StickyCTA from './components/StickyCTA';

const Landing = () => {
  return (
    <div className="bg-slate-900 min-h-screen text-slate-100 font-sans selection:bg-teal-500/30 selection:text-teal-200">
      <HeroSection />
      <StudentGallery />
      <Testimonials />
      <ValueStack />
      <Pricing />
      <DashboardPreview />
      <StickyCTA />

      {/* Simple Footer */}
      <footer className="bg-slate-950 py-12 border-t border-slate-800/50">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-6">
            <div className="w-8 h-8 bg-teal-500 rounded-lg flex items-center justify-center text-slate-900 font-black text-xl">A</div>
            <span className="font-black text-xl tracking-tighter text-white">Apex Scholars</span>
          </div>
          <p className="text-slate-500 text-sm font-medium mb-4">© {new Date().getFullYear()} Apex Scholars. All rights reserved.</p>
          <div className="flex justify-center gap-6 text-xs font-bold uppercase tracking-widest text-slate-600">
            <a href="#" className="hover:text-teal-500 transition-colors">Privacy</a>
            <a href="#" className="hover:text-teal-500 transition-colors">Terms</a>
            <a href="#" className="hover:text-teal-500 transition-colors">Support</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
