import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE } from "./config";

// Langue choisie par cookie, sans préfixe dans l'URL : les liens restent les mêmes en FR et en EN.
export default getRequestConfig(async () => {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(value) ? value : DEFAULT_LOCALE;
  return { locale, messages: (await import(`../../messages/${locale}.json`)).default };
});
