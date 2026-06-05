export type SolutionSection = {
  heading: string;
  paragraphs: string[];
};

export type SolutionFeature = {
  title: string;
  description: string;
};

export type SolutionFaq = {
  question: string;
  answer: string;
};

export type SolutionPageContent = {
  slug: string;
  path: string;
  seoTitle: string;
  metaDescription: string;
  h1: string;
  eyebrow: string;
  intro: string;
  sections: SolutionSection[];
  features: SolutionFeature[];
  faqs: SolutionFaq[];
};

export const SOLUTION_PAGE_SLUGS = [
  "pharmacy-pos-uganda",
  "supermarket-pos-uganda",
  "restaurant-pos-uganda",
  "retail-pos-uganda",
  "inventory-management-uganda",
] as const;

export type SolutionPageSlug = (typeof SOLUTION_PAGE_SLUGS)[number];

export const SOLUTION_PAGES: Record<SolutionPageSlug, SolutionPageContent> = {
  "pharmacy-pos-uganda": {
    slug: "pharmacy-pos-uganda",
    path: "/solutions/pharmacy-pos-uganda",
    seoTitle: "Pharmacy POS Uganda | Waka POS for Chemists & Drug Shops",
    metaDescription:
      "Pharmacy POS Uganda built for chemists and drug shops. Track medicine stock, expiry dates, dispensing, debts, receipts, and daily reports with Waka POS — offline-ready with cloud backup.",
    h1: "Pharmacy POS software for chemists and drug shops in Uganda",
    eyebrow: "Pharmacy POS Uganda",
    intro:
      "Running a pharmacy or drug shop in Uganda means balancing fast dispensing, accurate stock, expiry control, and clear records for owners and inspectors. Waka POS gives chemists a practical pharmacy POS system on the phones and tablets you already use — with medicine-friendly stock, expiry alerts, patient debts, receipt printing, and reports that still work when mobile data is slow.",
    sections: [
      {
        heading: "Built for how Ugandan pharmacies actually sell",
        paragraphs: [
          "Many chemists sell the same medicine by tablet, strip, or full box depending on what the patient can afford. Waka POS supports pharmacy mode with packaging levels, so staff can dispense in the unit customers expect while inventory stays accurate in base units. Search by medicine name, strength, or form — for example Paracetamol 500mg tablets — and add lines quickly at the counter without retyping labels every time.",
          "When a medicine is near expiry or already expired, the system warns staff before checkout according to your shop rules. You can block expired sales or allow a controlled override with a clear warning, helping reduce accidental dispensing of unsellable stock. The pharmacy dashboard shows expiring and expired stock value at a glance, so owners can discount, return, or write off before losses grow.",
        ],
      },
      {
        heading: "Inventory management that respects expiry and margins",
        paragraphs: [
          "Stock pages in pharmacy mode focus on medicines: categories such as antibiotics, pain relief, and chronic care; cost and selling price per unit; and optional expiry dates when adding products. Low-stock alerts tell you what to reorder before shelves go empty. Stock movement history helps explain shrinkage, returns, and restocking to partners or auditors.",
          "Pharmacy margin reports show whether dispensing is actually profitable after purchase cost — not just revenue. Owners can review top medicines, today's profit, and inventory value at risk from expiring stock. Combined with daily sales summaries and receipt history, you get a clearer picture than notebook tallies alone.",
        ],
      },
      {
        heading: "Debts, receipts, and accountable staff",
        paragraphs: [
          "Patients often buy on credit or through corporate schemes. Waka POS tracks customer balances and debt payments alongside normal cash and mobile money sales, so follow-up is visible in one place instead of scattered notebooks. Printed or shared receipts help patients verify what they received — important for trust and repeat visits.",
          "Multi-user access lets owners add staff with role-based permissions: who can sell, adjust stock, view profit, or run reports. Activity is tied to signed-in users, which supports accountability when multiple dispensers share one shop. When internet returns, multi-device sync and cloud backup help keep sales and stock aligned across counters and the owner's device.",
        ],
      },
      {
        heading: "Offline selling and barcode support for busy counters",
        paragraphs: [
          "Power cuts and weak mobile data are normal in many Kampala and upcountry locations. Waka POS continues recording sales offline; sync and backup run when connectivity is back. That means the queue keeps moving instead of stopping every time the network drops.",
          "Barcode support speeds up lookup for packaged medicines and retail items with printed codes. Pair Bluetooth receipt printers from hardware settings when you want paper receipts for patients or daily reconciliation. For shops upgrading from manual records, Waka offers a free start with optional paid plans when you need more products, staff, or backup capacity.",
        ],
      },
    ],
    features: [
      { title: "Medicine expiry tracking", description: "Monitor expiring and expired stock with dashboard tiles and reports before value is lost." },
      { title: "Dispense by tablet, strip, or box", description: "Sell in customer-facing units while stock counts stay correct in base units." },
      { title: "Inventory management", description: "Add medicines with strength, form, categories, costs, and minimum stock alerts." },
      { title: "Pharmacy margin reports", description: "See profit and top medicines — not only gross sales." },
      { title: "Debt tracking", description: "Record patient credit and payments without a separate ledger." },
      { title: "Receipt printing", description: "Connect Bluetooth printers for patient receipts and end-of-day reconciliation." },
      { title: "Multi-user access", description: "Staff roles control who can sell, adjust stock, or view sensitive reports." },
      { title: "Offline capability", description: "Keep dispensing when the network fails; sync when back online." },
      { title: "Barcode support", description: "Scan packaged items for faster checkout at the counter." },
      { title: "Multi-device sync", description: "Cloud backup aligns stock and sales across devices." },
    ],
    faqs: [
      {
        question: "Does Waka POS work for small drug shops as well as larger chemists?",
        answer:
          "Yes. Waka POS scales from a single-counter drug shop to multi-staff chemists. Start in Free Mode and add staff, products, and cloud backup as the business grows.",
      },
      {
        question: "Can we track medicine expiry dates in Waka POS?",
        answer:
          "Pharmacy mode supports expiry dates on products, expiry reports, dashboard alerts, and configurable rules that warn or block sales of expired medicines.",
      },
      {
        question: "Can dispensers sell a few tablets instead of a full box?",
        answer:
          "Yes. Pharmacy packaging lets you configure tablets, strips, and boxes with pricing per unit type so partial sales update stock correctly.",
      },
      {
        question: "What happens when internet is down?",
        answer:
          "Sales and stock changes are stored locally on the device. When connectivity returns, sync and backup upload pending data so owners can reconcile.",
      },
      {
        question: "Can we print receipts for patients?",
        answer:
          "Yes. Waka POS supports receipt output and Bluetooth printer setup from hardware settings for paper receipts where required.",
      },
      {
        question: "How do we control which staff see profit or stock costs?",
        answer:
          "Role-based permissions limit access to profit reports, stock costs, settings, and other sensitive actions per staff account.",
      },
    ],
  },

  "supermarket-pos-uganda": {
    slug: "supermarket-pos-uganda",
    path: "/solutions/supermarket-pos-uganda",
    seoTitle: "Supermarket POS Uganda | Waka POS for Grocery & Retail Stores",
    metaDescription:
      "Supermarket POS Uganda for grocery stores and mini-markets. Fast checkout, barcode scanning, inventory management, staff access, sales reports, debts, and offline POS with cloud sync.",
    h1: "Supermarket POS for grocery stores and mini-markets in Uganda",
    eyebrow: "Supermarket POS Uganda",
    intro:
      "Supermarkets and mini-markets move hundreds of SKUs every day — packaged food, household goods, beverages, and fresh items sold by unit or weight. Waka POS is supermarket POS software designed for Ugandan stores that need fast checkout, reliable inventory management, barcode support, multi-user staff access, and owner reports without enterprise complexity or cost.",
    sections: [
      {
        heading: "Fast checkout for high-volume tills",
        paragraphs: [
          "At peak hours, every second at the till matters. Waka POS lets cashiers search products by name or scan barcodes on packaged goods, add quantities quickly, and complete sales with cash, mobile money, or mixed payments. Quick presets and category browsing help when labels are missing or barcodes fail — common in local supply chains.",
          "Receipt printing gives customers proof of purchase and helps supervisors reconcile cash drawers at close. Owners can review receipt history by date range to investigate voids, returns, or shift differences without digging through paper stacks.",
        ],
      },
      {
        heading: "Inventory management across many products",
        paragraphs: [
          "Supermarket stock spans aisles and storage rooms. Waka POS tracks stock on hand, cost and selling price, categories, and minimum stock alerts so buyers know what to reorder. Restock and supplier workflows support recording incoming goods and updating quantities after deliveries — reducing the gap between what the shelf shows and what the system knows.",
          "Stock movement panels document adjustments, sales deductions, and restocking events. For stores that also sell on credit to regular customers or staff, debt tracking keeps balances visible next to daily cash sales.",
        ],
      },
      {
        heading: "Sales reports owners actually open",
        paragraphs: [
          "Daily close and sales reports summarize what each day brought in — by payment type, top products, and time period. Profit views help owners see whether discounts and supplier costs still leave margin. Monthly report exports support longer planning without rebuilding spreadsheets from scratch.",
          "Multi-user access separates cashier, supervisor, and owner capabilities. Cashiers sell; supervisors may manage stock or pending sales; owners review profit and settings. Permissions reduce accidental price changes or stock edits during busy shifts.",
        ],
      },
      {
        heading: "Offline POS and multi-device sync for real networks",
        paragraphs: [
          "Ugandan supermarkets often operate through unstable power and data. Waka POS records sales offline so tills do not freeze when the connection drops. When devices reconnect, multi-device sync and cloud backup merge local sales with the shop record — critical when owners monitor remotely or run more than one counter.",
          "Waka POS runs on Android phones and tablets many teams already own, lowering hardware cost compared with imported all-in-one terminals. Local support from Waka Technologies in Kampala helps with setup, staff training, and upgrades when the store is ready for paid backup and expanded limits.",
        ],
      },
    ],
    features: [
      { title: "Barcode support", description: "Scan packaged goods for faster checkout and fewer manual lookups." },
      { title: "Inventory management", description: "Track thousands of SKUs with categories, costs, alerts, and restock." },
      { title: "Sales reports", description: "Daily close, top products, and profit views for owners and managers." },
      { title: "Receipt printing", description: "Bluetooth printers for customer receipts and shift reconciliation." },
      { title: "Debt tracking", description: "Manage store credit for regular customers alongside cash sales." },
      { title: "Multi-user access", description: "Separate cashier and owner permissions across shifts." },
      { title: "Offline capability", description: "Continue selling through outages; sync when online." },
      { title: "Multi-device sync", description: "Keep stock and sales aligned across counters and owner devices." },
      { title: "Suppliers & restock", description: "Record incoming stock and supplier purchases in one flow." },
      { title: "Pending sales", description: "Park and resume complex baskets during rush periods." },
    ],
    faqs: [
      {
        question: "Can Waka POS handle a large product list like a supermarket?",
        answer:
          "Yes. Waka POS is built for retailers with large catalogues. Paid plans expand product and staff limits as your store grows beyond Free Mode.",
      },
      {
        question: "Do you support barcode scanners?",
        answer:
          "Waka POS supports barcode entry for product lookup at checkout and stock management, suitable for packaged supermarket goods.",
      },
      {
        question: "Can several cashiers use Waka POS at the same time?",
        answer:
          "Multiple staff accounts can sign in with their own permissions. Cloud sync helps align sales and stock across devices when online.",
      },
      {
        question: "What if power or internet fails during a busy Saturday?",
        answer:
          "Sales continue offline on the device. Data syncs to the cloud when connectivity returns so owners can still reconcile the day.",
      },
      {
        question: "Can owners see profit and not just total sales?",
        answer:
          "Yes. When cost prices are recorded, profit and margin reports show whether promotions and shrinkage are eating margin.",
      },
      {
        question: "Is there a free way to try before committing?",
        answer:
          "You can start in Free Mode or open the public demo from the website to explore checkout, stock, and reports before registering.",
      },
    ],
  },

  "restaurant-pos-uganda": {
    slug: "restaurant-pos-uganda",
    path: "/solutions/restaurant-pos-uganda",
    seoTitle: "Restaurant POS Uganda | Waka POS for Restaurants, Bars & Cafés",
    metaDescription:
      "Restaurant POS Uganda for restaurants, bars, and cafés. Table orders, kitchen workflow, fast checkout, sales reports, staff roles, receipt printing, and offline mode with Waka POS.",
    h1: "Restaurant POS for restaurants, bars, and cafés in Uganda",
    eyebrow: "Restaurant POS Uganda",
    intro:
      "Restaurants, bars, and cafés in Uganda need more than a basic till — they need table service, kitchen coordination, fast reorders, and clear end-of-day totals. Waka POS offers restaurant POS software with hospitality features including floor plans, table orders, kitchen display, multi-user staff access, sales reports, and offline capability when connectivity is unreliable.",
    sections: [
      {
        heading: "Table service and floor management",
        paragraphs: [
          "Hospitality mode adapts Waka POS for sit-down service. Staff can work from a floor plan view, open table sessions, add items as guests order, and keep running tabs until the table is ready to pay. This reduces lost orders compared with shouting across the room or scribbling on paper dockets.",
          "Table order screens are built for speed — search menu items, adjust quantities, and send updates without leaving the floor. When guests move or combine tables, staff can settle accounts from the same session history so totals stay transparent.",
        ],
      },
      {
        heading: "Kitchen display and order flow",
        paragraphs: [
          "Kitchen display shows pending items so cooks see what to prepare next, separated from front-of-house noise. Orders move from table to kitchen to payment with less verbal back-and-forth — especially helpful during lunch rush or weekend evenings when miscommunication is costly.",
          "For quick-service cafés or bars that do not use tables, kiosk-style quick sell still supports fast checkout with categories and presets for popular drinks and plates.",
        ],
      },
      {
        heading: "Checkout, receipts, and daily restaurant reports",
        paragraphs: [
          "When guests are ready to leave, staff close the table to checkout with cash, mobile money, or split payments as the business allows. Receipt printing provides guests a paper record and helps managers match till cash at close.",
          "Sales reports and daily close summarise service performance — what sold, when, and through which payment methods. Owners compare days and weeks without manually adding notebook columns. Cash expenses can be recorded alongside sales for a simpler daily picture of what stayed in the business.",
        ],
      },
      {
        heading: "Staff roles, offline service, and owner oversight",
        paragraphs: [
          "Restaurants run on teams: waiters, cashiers, kitchen, and managers. Multi-user access with role permissions controls who opens tables, edits orders, closes days, or views profit. That structure protects settings and sensitive reports while keeping service staff focused on guests.",
          "Weak mobile data should not stop service. Waka POS works offline so orders and payments are captured on device; multi-device sync updates the cloud when the network is stable. Owners can review activity from another phone — useful for multi-branch or supervisor oversight.",
        ],
      },
    ],
    features: [
      { title: "Floor plan & table orders", description: "Manage dine-in sessions from a visual floor layout." },
      { title: "Kitchen display", description: "Route orders to the kitchen screen for preparation." },
      { title: "Fast checkout", description: "Close tables with flexible payments and clear receipts." },
      { title: "Sales reports", description: "Daily close and sales summaries for managers and owners." },
      { title: "Receipt printing", description: "Bluetooth printers for guest bills and shift totals." },
      { title: "Multi-user access", description: "Roles for waiters, kitchen, cashiers, and managers." },
      { title: "Offline capability", description: "Keep serving when connectivity drops." },
      { title: "Multi-device sync", description: "Sync orders and payments across devices when online." },
      { title: "Cash expenses", description: "Record daily operating costs next to sales." },
      { title: "Menu categories", description: "Organise food and drinks for quick search at service." },
    ],
    faqs: [
      {
        question: "Is Waka POS only for full restaurants?",
        answer:
          "No. Hospitality mode suits restaurants, bars, hotel dining, cafés, and quick-service counters. Table features can be used where needed; quick sell works for simpler setups.",
      },
      {
        question: "Can waiters order from phones while on the floor?",
        answer:
          "Yes. Waka POS runs on mobile devices so staff can take table orders without a fixed terminal at one corner of the room.",
      },
      {
        question: "Does the kitchen see orders without paper tickets?",
        answer:
          "Kitchen display lists pending items for preparation, reducing reliance on handwritten kitchen chits.",
      },
      {
        question: "Can we run Waka POS when internet is slow?",
        answer:
          "Yes. Orders and payments are stored locally offline and sync when the connection is available.",
      },
      {
        question: "Can managers restrict who closes the day or sees profit?",
        answer:
          "Role-based permissions limit sensitive actions like day close, profit reports, and settings to trusted staff.",
      },
      {
        question: "How do we try restaurant features before signup?",
        answer:
          "Use the free demo on the website or register a Free Mode account and enable hospitality business type during setup.",
      },
    ],
  },

  "retail-pos-uganda": {
    slug: "retail-pos-uganda",
    path: "/solutions/retail-pos-uganda",
    seoTitle: "Retail POS Uganda | Waka POS for Shops & Boutiques",
    metaDescription:
      "Retail POS Uganda for boutiques, electronics shops, and general retail. Inventory management, barcode checkout, debt tracking, receipts, sales reports, staff access, and offline sync.",
    h1: "Retail POS for boutiques, electronics, and general shops in Uganda",
    eyebrow: "Retail POS Uganda",
    intro:
      "Retail shops across Uganda — boutiques, phone accessories, hardware counters, and neighbourhood stores — need a POS that handles varied products, customer credit, and owner visibility without a complicated back office. Waka POS is retail POS software with inventory management, barcode support, debt tracking, receipt printing, multi-user staff access, sales reports, and offline selling for everyday Ugandan retail.",
    sections: [
      {
        heading: "Checkout that fits mixed retail baskets",
        paragraphs: [
          "Retail baskets mix items with and without barcodes — a phone case with a code, a cable sold by unit, a discount for a regular customer. Waka POS supports barcode lookup where available and quick search by name or category everywhere else. Staff add quantities, apply line-level clarity, and complete payment in a few taps.",
          "Receipt printing gives buyers documentation for warranties or returns and helps owners match mobile money notifications with till activity at day end.",
        ],
      },
      {
        heading: "Inventory management without a separate spreadsheet",
        paragraphs: [
          "Every sale should reduce stock; every delivery should increase it. Waka POS tracks stock on hand, cost and sell price, categories, and low-stock alerts. Restock flows and supplier records help buyers remember what they ordered and what arrived — reducing the classic gap between warehouse count and shelf reality.",
          "Stock movement history shows what changed and when — useful when investigating missing items or training new stock keepers. For retailers who sell on credit, customer debt balances sit beside walk-in cash sales so follow-up is visible.",
        ],
      },
      {
        heading: "Reports and profit visibility for shop owners",
        paragraphs: [
          "Owners need more than a daily total in a drawer. Sales reports show top products, payment mix, and period comparisons. Profit views highlight whether markdowns and supplier costs still leave margin — especially important for electronics and fashion where costs vary by shipment.",
          "Daily close routines help supervisors lock the day, record cash expenses, and hand owners a cleaner summary than informal notes.",
        ],
      },
      {
        heading: "Teams, offline retail, and cloud backup",
        paragraphs: [
          "Retail shops rarely have one person doing everything. Multi-user access lets owners add sales staff, stock keepers, and supervisors with different permissions — who can change prices, adjust stock, or open profit reports.",
          "When mobile data fails, offline capability keeps the shop trading. Multi-device sync and cloud backup upload sales and stock changes when connectivity returns, so an owner checking from home still sees an honest picture. Waka POS starts free and upgrades when the shop needs more capacity — practical for SMEs growing from one counter to several staff.",
        ],
      },
    ],
    features: [
      { title: "Retail checkout", description: "Fast sell screen with search, categories, and quantity entry." },
      { title: "Barcode support", description: "Look up packaged SKUs quickly at the counter." },
      { title: "Inventory management", description: "Stock levels, alerts, categories, and restock workflows." },
      { title: "Debt tracking", description: "Customer credit balances and payment history in one place." },
      { title: "Sales reports", description: "Top products, daily totals, and period summaries." },
      { title: "Receipt printing", description: "Bluetooth receipt printers for buyers and reconciliation." },
      { title: "Multi-user access", description: "Staff accounts with role-based permissions." },
      { title: "Offline capability", description: "Sell through outages; sync when back online." },
      { title: "Multi-device sync", description: "Align sales and inventory across shop devices." },
      { title: "Profit tracking", description: "Margin visibility when cost prices are maintained." },
    ],
    faqs: [
      {
        question: "Which retail shops is Waka POS best for?",
        answer:
          "Boutiques, electronics shops, cosmetics, hardware counters, and general neighbourhood stores that need stock plus checkout on mobile devices.",
      },
      {
        question: "Can we track customer credit in Waka POS?",
        answer:
          "Yes. Customer records support debt balances and payments alongside normal sales.",
      },
      {
        question: "Does Waka POS require expensive POS hardware?",
        answer:
          "No. Waka POS runs on Android phones and tablets. Bluetooth printers are optional where you want paper receipts.",
      },
      {
        question: "Can stock keepers update inventory separately from cashiers?",
        answer:
          "Yes. Different staff roles can be limited to stock tasks versus checkout, protecting prices and sensitive reports.",
      },
      {
        question: "What happens to sales made offline?",
        answer:
          "They are stored on the device and included in reports after sync — so end-of-day totals stay complete.",
      },
      {
        question: "How do I start using Waka POS in my shop?",
        answer:
          "Open the demo, create a free account, add products, and invite staff. Waka support in Kampala can help with onboarding if needed.",
      },
    ],
  },

  "inventory-management-uganda": {
    slug: "inventory-management-uganda",
    path: "/solutions/inventory-management-uganda",
    seoTitle: "Inventory Management Uganda | Waka POS Stock & Reporting",
    metaDescription:
      "Inventory management Uganda for shops, pharmacies, supermarkets, and restaurants. Track stock, suppliers, movements, alerts, sales reports, barcode support, offline mode, and multi-device sync with Waka POS.",
    h1: "Inventory management software for Ugandan businesses",
    eyebrow: "Inventory Management Uganda",
    intro:
      "Stock is cash sitting on your shelf — until it goes missing, expires, or sells at the wrong price. Waka POS gives Ugandan businesses inventory management tied directly to daily sales: every receipt updates stock, every restock adds it back, and owners see alerts, movements, and reports without maintaining a separate spreadsheet. Works for pharmacies, supermarkets, restaurants, and retail shops on one platform.",
    sections: [
      {
        heading: "Stock records connected to real sales",
        paragraphs: [
          "Many Ugandan businesses track sales in one notebook and stock in another — then wonder why numbers never match. Waka POS links checkout to inventory automatically. When staff sell by unit, weight, or packaged quantity, stock on hand reduces immediately. Returns and adjustments can be recorded with movement history so changes are explainable later.",
          "Products support categories, SKU codes, cost and selling price, and minimum stock alerts. Pharmacy businesses can add expiry dates; hospitality venues track menu items; retailers use barcodes on packaged goods. One system adapts to how each sector counts stock.",
        ],
      },
      {
        heading: "Restock, suppliers, and receiving goods",
        paragraphs: [
          "Inventory management is not only counting — it is buying well. Waka POS supports supplier records and restock workflows so buyers log what arrived, at what cost, and in which quantities. That feeds margin reports and helps compare supplier prices over time.",
          "Low-stock alerts prompt reorders before shelves look empty to customers. For businesses with back storage, keeping the system updated after deliveries is still faster than full manual recounts every week.",
        ],
      },
      {
        heading: "Movements, audits, and sector-specific reports",
        paragraphs: [
          "Stock movement panels document sales deductions, restocks, adjustments, and write-offs — including pharmacy expired stock handling where enabled. When owners investigate shrinkage, they see a trail instead of guessing.",
          "Sales reports and inventory value summaries complement stock pages: top-moving lines, slow movers, and daily revenue. Pharmacy mode adds expiry reports; retail and supermarket users lean on category views and profit; restaurants focus on menu item consumption through service. The same inventory engine supports each vertical.",
        ],
      },
      {
        heading: "Multi-user teams, offline counts, and cloud sync",
        paragraphs: [
          "Several staff often touch inventory — receiving, shelving, selling. Multi-user access limits who can adjust stock or costs, reducing accidental or unauthorised changes. Cashiers sell; stock keepers restock; owners review.",
          "Offline capability means stock-taking and selling continue when the network is down. Multi-device sync merges updates when devices reconnect, so the owner phone and shop counter converge on the same numbers. Cloud backup protects against device loss — important when inventory data is as valuable as cash.",
        ],
      },
    ],
    features: [
      { title: "Live stock on hand", description: "Quantities update as you sell and restock — no manual double entry." },
      { title: "Low-stock alerts", description: "Minimum levels trigger reminders before items run out." },
      { title: "Suppliers & restock", description: "Log deliveries, costs, and quantity received from suppliers." },
      { title: "Stock movements", description: "Audit trail for adjustments, sales, and write-offs." },
      { title: "Barcode support", description: "Identify products quickly at stocktake and checkout." },
      { title: "Sales reports", description: "See what moves fast and what ties up capital." },
      { title: "Multi-user access", description: "Control who can edit stock, costs, or reports." },
      { title: "Offline capability", description: "Record changes without internet; sync later." },
      { title: "Multi-device sync", description: "Keep inventory aligned across shop devices." },
      { title: "Expiry tracking", description: "Pharmacy mode monitors medicine expiry and at-risk value." },
    ],
    faqs: [
      {
        question: "Is Waka POS only inventory, or also a POS?",
        answer:
          "Waka POS combines inventory management and point of sale. Stock and sales stay in one system so totals stay accurate.",
      },
      {
        question: "Can inventory management work for pharmacies with expiry dates?",
        answer:
          "Yes. Pharmacy mode tracks expiry, expiring stock reports, and optional sale guards for expired medicines.",
      },
      {
        question: "Do restaurants use the same inventory features?",
        answer:
          "Yes. Menu items consume stock through service and kitchen orders, with reports reflecting what sold during each period.",
      },
      {
        question: "Can we import or add many products at once?",
        answer:
          "Shops typically add products during setup and grow the catalogue over time. Starter packs help new businesses begin faster by business type.",
      },
      {
        question: "What if two staff update stock on different phones?",
        answer:
          "Multi-device sync reconciles changes when devices are online. Offline edits sync when connectivity returns.",
      },
      {
        question: "Does inventory data back up to the cloud?",
        answer:
          "Paid plans include cloud backup and sync so stock and sales are not only on one phone.",
      },
    ],
  },
};

export function isSolutionPageSlug(slug: string): slug is SolutionPageSlug {
  return (SOLUTION_PAGE_SLUGS as readonly string[]).includes(slug);
}

export function getSolutionPage(slug: string): SolutionPageContent | null {
  if (!isSolutionPageSlug(slug)) return null;
  return SOLUTION_PAGES[slug];
}

export const SOLUTION_NAV_LINKS = SOLUTION_PAGE_SLUGS.map((slug) => ({
  slug,
  path: SOLUTION_PAGES[slug].path,
  label: SOLUTION_PAGES[slug].eyebrow,
}));
