# Waka POS — Google Play Store listing (copy-paste)

Use this document when filling in [Google Play Console](https://play.google.com/console) for **Waka POS**.

| Technical | Value |
|-----------|--------|
| **Package name** | `ug.waka.pos` |
| **Upload file** | `android/app/build/outputs/bundle/release/app-release.aab` |
| **Build command** | `npm run cap:bundle:release` (after `keystore.properties` is set) |
| **Play Store icon** | `resources/brand/icon-1024-cream.png` |
| **Privacy policy** | https://pos.waka.ug/privacy |
| **Terms** | https://pos.waka.ug/terms |
| **Support** | https://pos.waka.ug/support |
| **Website** | https://pos.waka.ug |
| **Developer / company** | WAKA MARKETPLACE LIMITED (Uganda) |
| **Support email** | support@waka.ug |

Bump `versionCode` and `versionName` in `android/app/build.gradle` before every new upload.

---

## 1. Store listing — Main store listing

### App name
```
Waka POS
```

### Short description (max 80 characters)
```
Simple POS for Ugandan shops — sales, stock, receipts, staff, works offline.
```
*(79 characters)*

### Full description (max 4000 characters)
```
Waka POS is a simple point-of-sale app built for shops, dukas, supermarkets, pharmacies, salons, and restaurants in Uganda. Run daily sales, track stock, print or share receipts, and see how your business is doing — without complicated systems or expensive hardware.

WHY WAKA POS
• Made for Ugandan businesses — prices in UGX, practical workflows
• Fast checkout designed for busy counters
• Works offline — keep selling when internet is slow; sync when you are back online
• Cloud backup so you can sign in on a new phone and recover your shop data
• Affordable for every business — start free and upgrade when you need more

SELL & GET PAID
• Quick sell screen for everyday items
• Receipts you can print or share
• Multiple payment methods (cash, mobile money, and more)
• Customer accounts and debt tracking

STOCK & PRODUCTS
• Add and edit products with categories
• Stock levels and low-stock awareness
• Purchase and supplier tools for back office (owner/manager)

YOUR TEAM
• Owner, manager, cashier, and stock-keeper roles
• Staff sign-in with PIN on the same device
• Control who can change prices, void sales, or open back office

REPORTS & DAY CLOSE
• Daily sales summary
• Profit and business reports (where your plan includes them)
• Close the day with a clear record

BACK OFFICE
• Settings for shop name, phone, and location
• Backup & sync status
• Subscription and upgrade options for growing businesses

WHO IT IS FOR
Shop owners and staff who want a reliable POS on Android phones and tablets — from kiosk and duka to growing retail outlets.

ABOUT WAKA
Waka POS is a product of WAKA MARKETPLACE LIMITED, a Ugandan technology company focused on practical tools for everyday business.

SUPPORT
Email: support@waka.ug
Web: https://pos.waka.ug/support

Privacy policy: https://pos.waka.ug/privacy
Terms: https://pos.waka.ug/terms
```

### App category
**Business** (primary). Optional secondary: **Productivity**.

### Contact details
| Field | Value |
|-------|--------|
| Email | support@waka.ug |
| Website | https://pos.waka.ug |
| Phone | *(optional — your Uganda support line)* |

### Graphic assets
| Asset | Spec | File in repo |
|-------|------|----------------|
| App icon | 512×512 PNG (32-bit, max 1024 KB) | `resources/brand/icon-1024-cream.png` |
| Feature graphic | 1024×500 JPG or PNG | Create in Canva: cream background, W logo, “Waka POS”, tagline |
| Phone screenshots | Min 2, max 8; 16:9 or 9:16 | Capture: Login, POS sell, Dashboard, Stock or Receipts |

Suggested screenshot captions (optional in Play):
1. Sign in to your shop account  
2. Fast checkout on the sell screen  
3. Today’s sales at a glance  
4. Manage products and stock  

---

## 2. Release notes

### First production release (version 1.0.0)
```
Welcome to Waka POS on Android.

• Sell products and print or share receipts
• Track stock and customers
• Staff accounts with role-based access
• Offline mode with cloud sync when online
• Back office for reports, settings, and backup

We are a Uganda-first product from WAKA MARKETPLACE LIMITED. Questions: support@waka.ug
```

### Example update (version 1.0.1)
```
• Faster app startup and sign-in
• Improved offline sync reliability
• Bug fixes and stability improvements

Thank you for using Waka POS. Support: support@waka.ug
```

---

## 3. App access (for Google reviewers)

**Policy → App content → App access**

Select: **All or some functionality is restricted** (login required).

### Instructions for reviewers (paste into Play Console)
```
Waka POS requires a shop owner account to use the main app.

HOW TO SIGN IN
1. Open the app.
2. On the welcome screen, tap Sign in (or use Google Sign-In if enabled).
3. Enter the test email and password provided below.
4. After sign-in, the app loads the shop dashboard. Tap Sell (POS) to open checkout.

STAFF LOGIN (optional test)
From Login → Staff sign-in: choose the test shop name, enter staff name and 4-digit PIN if staff credentials were provided.

INTERNET
An internet connection is required for first sign-in and cloud sync. Offline selling works after the shop data has loaded once.

If Google Sign-In is used, complete sign-in in the browser when prompted; the app returns automatically.
```

### Test credentials (you must create these — do not use real customer data)
```
Owner email: [CREATE e.g. play.review@waka.ug or your test Gmail]
Password: [CREATE a strong password]

Shop name shown after login: [e.g. Waka Play Review Shop]

Optional staff PIN test:
Staff name: Review Cashier
PIN: 1234
```

Create the account in Supabase (or your normal registration flow) **before** submitting for review. Confirm login works on a release build.

---

## 4. Data safety — suggested answers

**Policy → App content → Data safety → Start**

Answer based on your live app. Adjust if you change features.

### Does your app collect or share any of the required user data types?
**Yes**

### Is all of the user data collected by your app encrypted in transit?
**Yes** (HTTPS / TLS to Supabase and your APIs)

### Do you provide a way for users to request that their data is deleted?
**Yes** — via support email (support@waka.ug) and as described in the privacy policy.

---

### Data types to declare (typical for Waka POS)

#### Personal info
| Type | Collected | Shared | Purpose | Optional? |
|------|-----------|--------|---------|-----------|
| Name | Yes | No | Account management, App functionality | Required for account |
| Email address | Yes | No | Account management, App functionality | Required for account |
| User IDs | Yes | No | Account management, App functionality | Required |
| Phone number | Yes | No | Account management, App functionality | Optional (phone login / shop phone) |
| Address | Yes | No | App functionality (shop location/address) | Optional |

#### Financial info
| Type | Collected | Shared | Purpose |
|------|-----------|--------|---------|
| Purchase history | Yes | No | App functionality (sales records in the user’s shop) |

*Do **not** declare “Credit card number” unless you process cards inside the app. Mobile money is usually recorded as payment method on a sale, not card data.*

#### Location
| Type | Collected | Shared | Purpose | Optional? |
|------|-----------|--------|---------|-----------|
| Approximate location | Yes | No | App functionality (optional shop GPS) | Optional |
| Precise location | Yes | No | App functionality (optional shop GPS) | Optional |

#### Photos and videos
| Type | Collected | Shared | Purpose | Optional? |
|------|-----------|--------|---------|-----------|
| Photos | Yes | No | App functionality (optional product/stock camera) | Optional |

#### App activity
| Type | Collected | Shared | Purpose |
|------|-----------|--------|---------|
| App interactions | Yes | No | Analytics / diagnostics *(only if you use monitoring — otherwise omit)* |

*If you do not send analytics to third parties, skip “App interactions” or answer No.*

#### Device or other IDs
| Type | Collected | Shared | Purpose |
|------|-----------|--------|---------|
| Device or other IDs | Yes | No | App functionality (device id for sync/audit) |

---

### Data handling summary (Play form checkboxes)

| Question | Suggested answer |
|----------|------------------|
| Data collected | Yes |
| Data shared with third parties | No *(unless you share with ad networks — default No)* |
| Data sold | No |
| Data used for tracking | No |
| Committed to Play Families Policy | Yes *(if targeting general audience)* |
| Independent security review | No *(unless you have one)* |

### Third-party SDKs (declaration notes)
- **Supabase** — authentication, database, cloud sync (user account and shop business data).
- **Google Sign-In** (if enabled) — authentication only.

Privacy policy URL: **https://pos.waka.ug/privacy**

---

## 5. Content rating (IARC questionnaire) — guidance

Typical answers for a business POS (confirm in the form):

| Topic | Answer |
|-------|--------|
| Violence, sexual content, drugs, gambling | None |
| User-generated content | No *(or Limited if you add public content later)* |
| Location sharing | Yes — optional shop location |
| Personal info | Yes — account and business data |
| Digital purchases | Yes — in-app subscription/upgrade if offered |
| Unrestricted internet | Yes — app uses internet for sync and login |

Expected rating: **Everyone** or **PEGI 3** / low maturity (business app).

---

## 6. Ads, news, and target audience

| Section | Answer |
|---------|--------|
| Contains ads | No |
| News app | No |
| COVID-19 contact tracing / status | No |
| Target age | 18+ or not designed for children *(business app)* |
| Appeal to children | No |

---

## 7. Countries and pricing

| Field | Suggestion |
|-------|------------|
| Countries | Uganda (primary); add Kenya/Tanzania/Rwanda later if you support them |
| Price | Free to download |
| In-app products | Yes — if you sell subscriptions in-app; configure in **Monetize → Products** |

---

## 8. Play App Signing

On first upload:

1. Choose **Use Google Play App Signing**.
2. Upload the **AAB** signed with your upload key (`waka-release.jks`).
3. Save Google’s app signing certificate for API integrations if needed later.

Never lose `waka-release.jks` and passwords. Back them up offline.

---

## 9. Pre-launch checklist

- [ ] `.env.production.local` has production Supabase + `VITE_APP_URL=https://pos.waka.ug`
- [ ] `npm run cap:bundle:release` succeeds; `app-release.aab` opens without errors
- [ ] Supabase redirect URLs include `https://pos.waka.ug/auth/callback` and `https://localhost/auth/callback`
- [ ] Privacy policy live at https://pos.waka.ug/privacy
- [ ] Review test account created and tested on release build
- [ ] `versionCode` incremented vs any previous upload
- [ ] Internal testing track installed on a real device
- [ ] Screenshots and feature graphic uploaded
- [ ] Data safety + content rating complete (all green on Dashboard)

---

## 10. Internal testing rollout (recommended order)

1. **Release → Testing → Internal testing** → Create release → Upload AAB → Add testers (email list).
2. Install via opt-in link; test login, sell, sync, Google sign-in.
3. **Closed testing** (optional) — trusted shop owners.
4. **Production** → Promote release or upload new AAB → Submit for review.

---

## 11. Support blurb (Play “About the developer” if shown)

```
WAKA MARKETPLACE LIMITED builds practical technology for everyday business in Uganda. Waka POS helps shops manage sales, stock, and daily operations on Android. Support: support@waka.ug | https://pos.waka.ug
```

---

*Last updated for package `ug.waka.pos`, versionName `1.0.0`, versionCode `2`. Regenerate the AAB after any change to web env or native config.*
