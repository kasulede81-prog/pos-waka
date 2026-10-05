/**
 * Luganda corrections layered over the base `lg` dictionary (Phase 2, Batch 4).
 *
 * Mirrors `swOverrides`: keys listed here replace the base value — either because
 * the base entry was still English, or because the key was missing entirely and
 * fell back to English via `t()`. Keys not listed keep their base Luganda value.
 * Product terminology follows the existing dictionary: bipimo (points), abaguzi
 * (members/customers), ebyereeta (rewards), obwananyini (membership),
 * obuganzi (balance), okwagala (loyalty).
 */
export const lgOverrides: Record<string, string> = {
  confirm: "Kyakasa",

  // Allowance / usage (overview)
  loyaltyAllowanceActive: "Okwagala kwakolera",
  loyaltyAllowanceInactive: "Okwagala tekukolera",
  loyaltyAllowanceInactiveHint:
    "WAKA Loyalty tekukolera mu duka eno, n'lwakyo obwananyini obuggya tebukkirizibwa.",
  loyaltyAllowanceTitle: "Ekkubo ly'abaguzi",
  loyaltyAllowanceUsage: "{used} / {limit} abaguzi abakola",

  // Customer rewards (member detail)
  loyaltyCustomerRewardsAssign: "+ Teeka ekyereeta",
  loyaltyCustomerRewardsConfirm: "Teeka",
  loyaltyCustomerRewardsEmpty: "Tewali bili bitegekeddwa.",
  loyaltyCustomerRewardsExpires: "Okusunga gukka",
  loyaltyCustomerRewardsPick: "Ekyereeta",
  loyaltyCustomerRewardsRemove: "Kiwuula",
  loyaltyCustomerRewardsStatusActive: "Kikolera",
  loyaltyCustomerRewardsStatusUnavailable: "Tekikozesebwa",
  loyaltyCustomerRewardsSub: "Ebyereeta bitegekeddwa omuguzi guno kwokka.",
  loyaltyCustomerRewardsTitle: "Ebyereeta by'abaguzi",

  // Card design (cards section)
  loyaltyDesignAccent: "Eyongeramu",
  loyaltyDesignBackground: "Ensobozi",
  loyaltyDesignBrandTitle: "Bulaagi",
  loyaltyDesignPrimary: "Ekkulu",
  loyaltyDesignText: "Kiwandiiko",

  loyaltyEarnRuleSummary: "Empeera ey'okufuna: bipimo {points} ku UGX {unit} ebyogolokose.",

  // Error codes (loyaltyErrorKey mapping — never leak raw RPC codes)
  loyaltyErrAccountNotFound: "Omuguzi guno tewafunibwa mu duka eno.",
  loyaltyErrAccountRevoked: "Obwananyini buno bwaggyibwamu era tebukyusibwako.",
  loyaltyErrAccountSuspended: "Omuguzi guno ayimiriziddwa.",
  loyaltyErrAlreadyMember: "Omuguzi guno ayunga dda.",
  loyaltyErrAlreadyReviewed: "Omusabyo guno wasoomoozebwa dda.",
  loyaltyErrCooldown:
    "Ensimu eno esabyedwa dda eri duka eno. Neera oluvannyuma lw'ennaku musanvu.",
  loyaltyErrCustomerNotInShop: "Omuguzi guno togwa ku duka eno.",
  loyaltyErrInvalidAction: "Ekyo tekikolesebwa.",
  loyaltyErrInvalidReason: "Ensonga eno nnyingi nnyo.",
  loyaltyErrInvalidStatus: "Obwananyini buno tebuwera ekyo.",
  loyaltyErrLimitReached:
    "Ekkubo ly'abaguzi ly'okwagala lyajjuuka, n'lwakyo ekyo tekikolesebwa. Luttako omuguzi ku kimosi oluvannyuma ogezeeko dda.",
  loyaltyErrMembershipExpired: "Obwananyini buno bwaffeewo.",
  loyaltyErrNotEnabled: "DKASU Loyalty tekukolera mu duka eno.",
  loyaltyErrOffline: "Wuliwa nga tolina mukutu. Gezaako nate olwekyo olwo wanguwukira.",
  loyaltyErrProgramNotFound: "Tandika pulogulaamu y'okwagala gge ku ntandikwa.",
  loyaltyErrQueueFull:
    "Duka eno lyajjuuka nga emaasabyo tegyetuse. Gezaako nate omutuufu.",
  loyaltyErrRequestNotFound: "Omusabyo guno tewafunibwa.",
  loyaltyErrGeneric: "Ekyo tekikolesebwa. Gezaako nate.",

  // Public enrollment link / program code (cards section)
  loyaltyJoinMerchantCopied: "Kyakoppissewa",
  loyaltyJoinMerchantCopy: "Koppya link",
  loyaltyJoinMerchantGenerate: "Kuza QR y'okuyingira",
  loyaltyJoinMerchantNeedManage: "Abakulembera bokka basobola kuza QR ey'okuyingira eri abantu.",
  loyaltyJoinMerchantPrint: "Printa",
  loyaltyJoinMerchantPrintSub: "Skena oyunge",
  loyaltyJoinMerchantPrintTitle: "YUNGANI N'EPROGRAMU YAFFE Y'OKWAGALA",
  loyaltyJoinMerchantRegenerate: "Kuza dda QR",
  loyaltyJoinMerchantRegistrations: "Abazewa ku QR",
  loyaltyJoinMerchantRevoke: "Leka QR",
  loyaltyJoinMerchantRevokeConfirm:
    "Lekese QR eno ey'okuyingira? Abaguzi abaliyo tebakkuvuddeko. Okuskenya kuggya kujja kukka okutuusa olwekyo olwo wakuze QR empya.",
  loyaltyJoinNotFound: "Link eno ey'okuyingira tejikola.",

  // Membership lifecycle (member detail)
  loyaltyLifecycleActive: "AKOLERA",
  loyaltyLifecycleChangeExpiry: "Kyusa gukka",
  loyaltyLifecycleConfirm: "Kyakasa",
  loyaltyLifecycleConfirmRevoke: "Ggyawo obwananyini",
  loyaltyLifecycleHint:
    "Gukka kw'obwananyini kwawukana na kukka kw'ebyereeta, bipimo, n'ebyewa.",
  loyaltyLifecyclePurgesAfter: "Kijja kuggibwamu",
  loyaltyLifecycleReactivate: "Kudda okukolera",
  loyaltyLifecycleRevoke: "Ggyawo obwananyini",
  loyaltyLifecycleRevokeConfirm:
    "Okuggyawo obwananyini kujja kukuma ekiro. Ebirikwata ku muguzi — okwereereza kwe, amabaluwa ge, n'olwatuuka n'olw'ebyetaagisa ku bikolwa — tebijja kuggibwamu. Akaadi ky'okwagala n'ebyali kya kokka (bipimo, ebyereeta, ebyewa) bijja kuggibwamu oluvannyuma lw'ennaku 30.",
  loyaltyLifecycleRevoked: "KYAGGYIBWAMU",
  loyaltyLifecycleRevokedOn: "Kyaggyibwamu nga",
  loyaltyLifecycleSaveExpiry: "Tereka gukka",
  loyaltyLifecycleStatus: "Obwananyini",
  loyaltyLifecycleSuspend: "Yimiriza",
  loyaltyLifecycleSuspendConfirm:
    "Yimirizza obwananyini buno b'okwagala? Omuguzi tafuna bikolwa bya bipimo oba okukyusa ebyereeta okutuusa olwekyo olwo bwazimulizzibwa.",
  loyaltyLifecycleSuspended: "KYEYIMIRIZZIDWA",
  loyaltyLifecycleTitle: "Obwananyini n'embeera ye",

  // Member allowance copy
  loyaltyMemberLimitReached: "Ekkubo ly'abaguzi lyajjuuka.",
  loyaltyMembersRemaining: "Ebifo {count} by'abaguzi bisigadde",

  // Membership (member detail + settings)
  loyaltyMembershipDate: "Gukka nga",
  loyaltyMembershipExpired: "Obwananyini bwaffeewo",
  loyaltyMembershipExpiredRedeem: "Obwananyini bwaffeewo — uzima obwananyini oluvannyuma okukyusa",
  loyaltyMembershipExpiry: "Gukka kw'obwananyini",
  loyaltyMembershipFixed: "Siku eyokka egatteekeddwa",
  loyaltyMembershipHint:
    "Kutuula obwananyini bwa muguzi oba bulemererwa kasero. Kino tekukendeeza bipimo bye.",
  loyaltyMembershipMonths: "Emyeezi",
  loyaltyMembershipNever: "Tekukka",
  loyaltyMembershipRenew: "Zimuliza",
  loyaltyMembershipRenewed: "Obwananyini buzimuliddwa",
  loyaltyMembershipTitle: "Obwananyini b'okwagala",

  // Customer offers (member detail)
  loyaltyOffersCreate: "Tandika ekyewa",
  loyaltyOffersEffectiveMult: "Mupulayita ey'akolera",
  loyaltyOffersEmpty: "Tewali bili by'ebyewa.",
  loyaltyOffersFlatBonus: "Bonus eyetteekeddwa",
  loyaltyOffersInactiveWindow: "tekiri mu kiseera",
  loyaltyOffersPause: "Yimiriza",
  loyaltyOffersPriority: "Enyenya",
  loyaltyOffersResume: "Kudda okukolera",
  loyaltyOffersRevoke: "Ggyawo",
  loyaltyOffersSave: "Tereka ekyewa",
  loyaltyOffersSub:
    "Ebyewa, mupulayita, bonasi, n'ebyereeta ebongerako ku pulogulaamu y'edduka.",
  loyaltyOffersTitle: "Ebyewa by'abaguzi",
  loyaltyOffersTitleField: "Eyebilo ly'ekyewa",

  loyaltyPendingRequestsCount: "Emaasabyo ejja kusoomoozebwa: {count}",

  // Points expiry (settings)
  loyaltyPointsExpiry: "Bipimo bye bigenda",
  loyaltyPointsExpiryAfter: "Oluvannyuma",
  loyaltyPointsExpiryHint:
    "Bikwata ku bipimo ebiggya bifuuliddwa okka. Ebiwo aliwo tebikyusibwako. Ebiggyo bikolesebwa ku ntandikwa.",
  loyaltyPointsExpiryMonths: "emyezi",
  loyaltyPointsExpiryNever: "Tebigenda",
  loyaltyPointsExpiryTitle: "Bipimo",

  // Enrollment requests queue (cards section)
  loyaltyRequestsApprove: "Eikiriza",
  loyaltyRequestsApproved: "Omusabyo gukiriziddwa — obwananyini bwatandikiddwa.",
  loyaltyRequestsEmpty: "Tewali maasabyo ga kulaga.",
  loyaltyRequestsNotEnabled: "DKASU Loyalty tekukolera mu duka eno.",
  loyaltyRequestsQueueFull:
    "Omuyombo gw'emaasabyo wo ngweddamu ({limit}). Kiriza oba kaata emaasabyo emingi ng'adinga okujja amakya.",
  loyaltyRequestsReject: "Kaata",
  loyaltyRequestsRejectReason: "Ensonga (sirikakirizigwa)",
  loyaltyRequestsRejected: "Omusabyo kakanyibwa.",
  loyaltyRequestsRequested: "Wasabye",
  loyaltyRequestsReviewed: "Wasoomoozebwa",
  loyaltyRequestsSub: "Abaguzi abaskenya QR yo era nga basubira okukkirizibwa.",
  loyaltyRequestsTitle: "Emaasabyo gy'okuyingira",
  loyaltyRequestsUsage: "{used} ku {limit} abaguzi abakola",
  loyaltyRequestsViewMember: "Laba omuguzi",

  // Rewards (rewards tab + redeem card)
  loyaltyRewardEditExpiry: "Kyusa gukka",
  loyaltyRewardExpired: "Kyaffeewo",
  loyaltyRewardExpiredRedeem: "Ekyereeta kino kyaffeewo",
  loyaltyRewardExpiresOn: "Gukka nga",
  loyaltyRewardExpiry: "Gukka kw'ekyereeta",
  loyaltyRewardNeverExpires: "Tekukka",
  loyaltyRewardProductStock: "Ssitokki",

  // Member Google Wallet (member surface, reachable from merchant flows)
  loyaltyWalletMemberAdd: "Yongeramu ku Google Wallet",
  loyaltyWalletMemberCreating: "Tukutegyessa akaadi wo…",
  loyaltyWalletMemberHint:
    "Yongeramu akaadi wo ku Google Wallet lw'okukikubaako ku fooni yo ng'olw'okukozesa ku kasupe.",
  loyaltyWalletMemberOpenFailed:
    "Akaadi kyatengeddwa, naye Google Wallet ttaskadduse. Gezaako nate.",
  loyaltyWalletMemberOpened: "Tugula Google Wallet…",
  loyaltyWalletMemberRevoked:
    "Obwananyini buno bwaggyibwamu. Muwa obwananyini obuggya nga wala okuza akaadi y'okwagala.",
  loyaltyWalletMemberSuspended:
    "Omuguzi guno ayimiriziddwa. Akaadi ke ky'okwagala tekikozesebwa okutuusa olwekyo olwo obwananyini bwazimulizzibwa.",
};
