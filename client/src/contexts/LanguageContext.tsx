import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type Language = "en" | "bn" | "hi";

type TranslationKey = keyof typeof translations.en;

const translations = {
  en: {
    home: "Home", type: "Type", discover: "Discover", connections: "Connections", profile: "Profile", explore: "Explore", exploreSignals: "Explore signals", howItWorks: "How it works", login: "Log in", getStarted: "Get started", create: "Create", details: "Details", need: "I Need", can: "I Can", allSignals: "All signals", tech: "Tech", design: "Design", business: "Business", services: "Services", live: "Live", liveNetwork: "Live network", exploreNetwork: "Explore the network", findSignal: "Find the signal", thatMatters: "that matters", searchSignals: "Search signals, people, or tags...", clearSignals: "Discover clear NEEDs and CANs from people who are ready to make something useful happen.", startSignal: "Start with a clear signal.", browseSignals: "Browse active member signals, open a profile, and connect when you find a useful fit. Sign in to create your own NEED or CAN.", nivoNetwork: "The NIVO network", realPeople: "Real people. Clear signals.", language: "Language", english: "English", bangla: "বাংলা", hindi: "हिंदी", yourNivo: "Your NIVO", startMatters: "Start with what matters now.", activeSignals: "Your active signals", discoverPeople: "Discover people", shareIntention: "Share an intention", shareCapability: "Share a capability", postNeed: "Post a need", postFirstNeed: "Post your first need", opportunities: "Live opportunities", fitYourOwn: "Signals that may fit your own.", refineMatches: "Refine matches", noSignals: "No published signals match these filters yet.", noSignalsHelp: "Be the first to post a clear NEED or CAN in this space.", loadingSignals: "Loading live signals", retry: "Retry", verified: "Verified", pending: "Pending", message: "Message", connect: "Connect", reviewRequest: "Review request", locationPrivate: "Location private", everyoneNeeds: "Everyone needs. Everyone can.", signInCreate: "Sign in to create your own NEED or CAN.",
  },
  bn: {
    home: "হোম", type: "ধরন", discover: "আবিষ্কার", connections: "সংযোগ", profile: "প্রোফাইল", explore: "এক্সপ্লোর", exploreSignals: "সিগন্যাল দেখুন", howItWorks: "কীভাবে কাজ করে", login: "লগ ইন", getStarted: "শুরু করুন", create: "তৈরি করুন", details: "বিস্তারিত", need: "আমার প্রয়োজন", can: "আমি পারি", allSignals: "সব সিগন্যাল", tech: "প্রযুক্তি", design: "ডিজাইন", business: "ব্যবসা", services: "সেবা", live: "সক্রিয়", liveNetwork: "সক্রিয় নেটওয়ার্ক", exploreNetwork: "নেটওয়ার্ক আবিষ্কার করুন", findSignal: "প্রয়োজনীয় সিগন্যাল", thatMatters: "যা গুরুত্বপূর্ণ", searchSignals: "সিগন্যাল, মানুষ বা ট্যাগ খুঁজুন...", clearSignals: "যারা কিছু উপকারী করতে প্রস্তুত তাদের পরিষ্কার প্রয়োজন ও সক্ষমতা আবিষ্কার করুন।", startSignal: "একটি পরিষ্কার সিগন্যাল দিয়ে শুরু করুন।", browseSignals: "সক্রিয় সদস্যদের সিগন্যাল দেখুন, প্রোফাইল খুলুন এবং উপযুক্ত মানুষকে সংযোগের অনুরোধ পাঠান।", nivoNetwork: "NIVO নেটওয়ার্ক", realPeople: "বাস্তব মানুষ। পরিষ্কার সিগন্যাল।", language: "ভাষা", english: "English", bangla: "বাংলা", hindi: "हिंदी", yourNivo: "আপনার NIVO", startMatters: "যা গুরুত্বপূর্ণ তা দিয়ে শুরু করুন।", activeSignals: "আপনার সক্রিয় সিগন্যাল", discoverPeople: "মানুষ আবিষ্কার করুন", shareIntention: "একটি প্রয়োজন শেয়ার করুন", shareCapability: "একটি সক্ষমতা শেয়ার করুন", postNeed: "প্রয়োজন পোস্ট করুন", postFirstNeed: "প্রথম প্রয়োজন পোস্ট করুন", opportunities: "সক্রিয় সুযোগ", fitYourOwn: "আপনার জন্য উপযুক্ত সিগন্যাল", refineMatches: "ম্যাচ পরিমার্জন করুন", noSignals: "এই ফিল্টারে কোনো সিগন্যাল পাওয়া যায়নি।", noSignalsHelp: "এই জায়গায় প্রথম পরিষ্কার NEED বা CAN পোস্ট করুন।", loadingSignals: "সক্রিয় সিগন্যাল লোড হচ্ছে", retry: "আবার চেষ্টা করুন", verified: "যাচাইকৃত", pending: "অপেক্ষমাণ", message: "বার্তা", connect: "সংযোগ করুন", reviewRequest: "অনুরোধ দেখুন", locationPrivate: "অবস্থান গোপন", everyoneNeeds: "সবার প্রয়োজন আছে। সবাই কিছু দিতে পারে।", signInCreate: "নিজের NEED বা CAN তৈরি করতে লগ ইন করুন।",
  },
  hi: {
    home: "होम", type: "प्रकार", discover: "खोजें", connections: "कनेक्शन", profile: "प्रोफ़ाइल", explore: "एक्सप्लोर", exploreSignals: "सिग्नल देखें", howItWorks: "यह कैसे काम करता है", login: "लॉग इन", getStarted: "शुरू करें", create: "बनाएं", details: "विवरण", need: "मुझे चाहिए", can: "मैं कर सकता हूँ", allSignals: "सभी सिग्नल", tech: "टेक", design: "डिज़ाइन", business: "व्यवसाय", services: "सेवाएं", live: "लाइव", liveNetwork: "लाइव नेटवर्क", exploreNetwork: "नेटवर्क खोजें", findSignal: "वह सिग्नल खोजें", thatMatters: "जो मायने रखता है", searchSignals: "सिग्नल, लोगों या टैग खोजें...", clearSignals: "उन लोगों की स्पष्ट ज़रूरतें और क्षमताएं खोजें जो कुछ उपयोगी करने के लिए तैयार हैं।", startSignal: "एक स्पष्ट सिग्नल से शुरुआत करें।", browseSignals: "सक्रिय सदस्य सिग्नल देखें, प्रोफ़ाइल खोलें और सही व्यक्ति से जुड़ें। अपना NEED या CAN बनाने के लिए साइन इन करें।", nivoNetwork: "NIVO नेटवर्क", realPeople: "असली लोग। स्पष्ट सिग्नल।", language: "भाषा", english: "English", bangla: "বাংলা", hindi: "हिंदी", yourNivo: "आपका NIVO", startMatters: "जो मायने रखता है उससे शुरुआत करें।", activeSignals: "आपके सक्रिय सिग्नल", discoverPeople: "लोग खोजें", shareIntention: "ज़रूरत साझा करें", shareCapability: "क्षमता साझा करें", postNeed: "ज़रूरत पोस्ट करें", postFirstNeed: "पहली ज़रूरत पोस्ट करें", opportunities: "लाइव अवसर", fitYourOwn: "आपके लिए उपयुक्त सिग्नल", refineMatches: "मैच सुधारें", noSignals: "इन फ़िल्टर में कोई सिग्नल नहीं मिला।", noSignalsHelp: "इस जगह पहला स्पष्ट NEED या CAN पोस्ट करें।", loadingSignals: "लाइव सिग्नल लोड हो रहे हैं", retry: "फिर कोशिश करें", verified: "सत्यापित", pending: "लंबित", message: "संदेश", connect: "कनेक्ट करें", reviewRequest: "अनुरोध देखें", locationPrivate: "स्थान निजी", everyoneNeeds: "हर किसी को ज़रूरत है। हर कोई कुछ दे सकता है।", signInCreate: "अपना NEED या CAN बनाने के लिए साइन इन करें।",
  },
} as const;

export function translate(language: Language, key: TranslationKey) {
  return translations[language][key];
}

const LanguageContext = createContext<{ language: Language; setLanguage: (language: Language) => void; t: (key: TranslationKey) => string } | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    if (typeof window === "undefined") return "en";
    const saved = window.localStorage.getItem("nivo-language");
    return saved === "bn" || saved === "hi" ? saved : "en";
  });
  const setLanguage = (next: Language) => { setLanguageState(next); window.localStorage.setItem("nivo-language", next); };
  const value = useMemo(() => ({ language, setLanguage, t: (key: TranslationKey) => translate(language, key) }), [language]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("useLanguage must be used inside LanguageProvider");
  return value;
}

export function LanguageSelector() {
  const { language, setLanguage, t } = useLanguage();
  return <label className="language-selector"><span className="sr-only">{t("language")}</span><select value={language} onChange={(event) => setLanguage(event.target.value as Language)} aria-label={t("language")}><option value="en">EN · {t("english")}</option><option value="bn">BN · {t("bangla")}</option><option value="hi">HI · {t("hindi")}</option></select></label>;
}
