/** Re-exports for app support — canonical source: company.ts */
export {
  WAKA_BRAND_NAME,
  WAKA_SLOGAN,
  WAKA_LEGAL_COMPANY_NAME,
  WAKA_COMPANY_TYPE,
  WAKA_COMPANY_COUNTRY,
  WAKA_COMPANY_POSTAL_ADDRESS,
  WAKA_COMPANY_TAGLINE,
  WAKA_MAIN_PRODUCT,
  WAKA_SUPPORT_EMAILS,
  WAKA_SUPPORT_EMAIL,
  WAKA_SUPPORT_WHATSAPP_WA_ME,
  wakaSupportWhatsAppUrl,
  wakaSupportMailtoUrl,
} from "./company";

import { WAKA_OFFICE_STREET, WAKA_OFFICE_CITY, WAKA_OFFICE_REGION, WAKA_OFFICE_COUNTRY } from "./company";

/** Full registered office line for legal/support copy */
export const WAKA_COMPANY_LOCATION = `${WAKA_OFFICE_STREET}, ${WAKA_OFFICE_CITY}, ${WAKA_OFFICE_REGION}, ${WAKA_OFFICE_COUNTRY}`;

/** @deprecated use WAKA_SUPPORT_WHATSAPP_WA_ME from company */
export const WAKA_SUPPORT_WHATSAPP_E164 = "256792521711";
