import { Plus, Search, Sparkles } from "lucide-react";
import { LanguageSelector, useLanguage } from "@/contexts/LanguageContext";

type GuestLandingProps = {
  onLogin: () => void;
  onExplore: () => void;
  onHowItWorks: () => void;
};

export default function GuestLanding({ onLogin, onExplore, onHowItWorks }: GuestLandingProps) {
  const { t } = useLanguage();
  return (
    <div className="min-h-screen bg-[#0b121e] text-slate-100 font-sans pb-12 antialiased guest-layout">
      <header className="sticky top-0 z-50 bg-[#0b121e]/90 backdrop-blur-md border-b border-slate-800/80 px-5 py-3.5 flex items-center justify-between">
        <button type="button" onClick={onHowItWorks} className="flex items-center gap-2.5 text-left" aria-label="NIVO home">
          <span className="w-8 h-8 rounded-full bg-cyan-500/10 border border-cyan-400/40 flex items-center justify-center text-cyan-400 font-bold text-sm shadow-sm">N</span>
          <span className="font-bold text-lg tracking-tight text-white">NIVO <span className="font-light text-slate-300">Now</span></span>
        </button>
        <div className="flex items-center gap-2 sm:gap-3">
          <LanguageSelector /><button type="button" onClick={onLogin} className="text-xs font-medium text-slate-300 hover:text-white transition-colors">{t("login")}</button>
          <button type="button" onClick={onLogin} className="bg-[#00E5FF] hover:bg-cyan-300 text-slate-950 font-bold px-4 py-1.5 rounded-full text-xs transition-all shadow-md shadow-cyan-500/20 flex items-center gap-1">
            <Plus className="w-3.5 h-3.5 stroke-[3]" /> {t("getStarted")}
          </button>
        </div>
      </header>

      <nav className="flex items-center gap-6 px-6 py-3 border-b border-slate-800/50 text-xs font-medium text-slate-400 overflow-x-auto" aria-label="Guest navigation">
        <button type="button" onClick={onHowItWorks} className="hover:text-slate-200 transition-colors whitespace-nowrap">{t("home")}</button>
        <button type="button" onClick={onExplore} className="text-white font-semibold border-b-2 border-cyan-400 pb-1 whitespace-nowrap">{t("discover")}</button>
        <button type="button" onClick={onLogin} className="hover:text-slate-200 transition-colors whitespace-nowrap">{t("connections")}</button>
        <button type="button" onClick={onLogin} className="hover:text-slate-200 transition-colors whitespace-nowrap">{t("profile")}</button>
      </nav>

      <main className="max-w-md mx-auto px-4 pt-6 space-y-6">
        <section className="space-y-1.5" aria-labelledby="guest-discover-title">
          <p className="eyebrow text-cyan-400 flex items-center gap-2"><Sparkles size={13} /> {t("exploreNetwork")}</p>
          <h1 id="guest-discover-title" className="text-2xl font-bold tracking-tight text-white">{t("findSignal")} <br />{t("thatMatters")}</h1>
          <p className="text-xs text-slate-400 leading-relaxed max-w-xs">{t("clearSignals")}</p>
        </section>

        <button type="button" onClick={onExplore} className="relative w-full text-left group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <span className="block w-full bg-[#141d2b] border border-slate-800 rounded-2xl pl-10 pr-4 py-3 text-xs text-slate-500 group-hover:border-cyan-400/60 transition-all">{t("searchSignals")}</span>
        </button>

        <div className="space-y-2" aria-label="Discover filters">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none text-xs">
            <button type="button" onClick={onExplore} className="px-3.5 py-1.5 rounded-full font-semibold border border-cyan-400 text-cyan-400 bg-cyan-950/30 whitespace-nowrap">{t("need")}</button>
            <button type="button" onClick={onExplore} className="px-3.5 py-1.5 rounded-full font-medium border border-slate-800 text-slate-300 bg-[#141d2b] whitespace-nowrap">{t("can")}</button>
            <button type="button" onClick={onExplore} className="px-3.5 py-1.5 rounded-full font-medium border border-slate-800 text-slate-300 bg-[#141d2b] whitespace-nowrap">{t("tech")}</button>
            <button type="button" onClick={onExplore} className="px-3.5 py-1.5 rounded-full font-medium border border-slate-800 text-slate-300 bg-[#141d2b] whitespace-nowrap">{t("design")}</button>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none text-xs">
            <button type="button" onClick={onExplore} className="px-3 py-1 rounded-full font-medium bg-[#141d2b] text-slate-400 border border-slate-800 whitespace-nowrap">{t("allSignals")}</button>
            <button type="button" onClick={onExplore} className="px-3 py-1 rounded-full font-medium bg-[#141d2b] text-slate-400 border border-slate-800 whitespace-nowrap">{t("business")}</button>
            <button type="button" onClick={onExplore} className="px-3 py-1 rounded-full font-medium bg-[#141d2b] text-slate-400 border border-slate-800 whitespace-nowrap">{t("services")}</button>
          </div>
        </div>

        <section className="bg-[#131c2a]/90 border border-slate-800/90 rounded-3xl p-5 shadow-2xl backdrop-blur-xl space-y-4">
          <div className="flex items-center justify-between">
            <span className="px-3 py-1 rounded-full bg-slate-800 text-slate-300 text-[11px] font-semibold border border-slate-700/60">{t("liveNetwork")}</span>
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-cyan-300 bg-cyan-950/40 border border-cyan-500/20 px-2.5 py-0.5 rounded-full"><span className="w-1.5 h-1.5 rounded-full bg-cyan-300" /> {t("explore")}</span>
          </div>
          <div className="space-y-2">
            <h2 className="text-base font-bold text-white leading-snug">{t("startSignal")}</h2>
            <p className="text-xs text-slate-400 leading-relaxed">{t("browseSignals")}</p>
          </div>
          <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5"><span className="w-8 h-8 rounded-full bg-gradient-to-tr from-slate-700 to-slate-800 border border-slate-600 flex items-center justify-center text-slate-200 text-xs font-bold">N</span><div><p className="text-xs font-semibold text-slate-200">{t("nivoNetwork")}</p><p className="text-[10px] text-slate-500">{t("realPeople")}</p></div></div>
            <button type="button" onClick={onExplore} className="bg-[#00E5FF] hover:bg-cyan-300 text-slate-950 font-bold px-4 py-1.5 rounded-full text-xs transition-all shadow-md shadow-cyan-500/20">{t("details")}</button>
          </div>
        </section>
      </main>
    </div>
  );
}
