import { useCallback } from "react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { shopActionErrorMessage, shopActionSuccessMessage } from "../lib/shopNotification";
import { executeShopAction, type ShopActionResult, type ShopActionRunnerOptions } from "../lib/shopActionRunner";
import { useToast } from "../context/ToastProvider";

export type UseShopActionOptions = Omit<
  ShopActionRunnerOptions,
  "onSuccess" | "onError" | "permissionDeniedMessage"
> & {
  lang: Language;
  action: string;
  successKey?: string;
  errorKey?: string;
  permissionDeniedKey?: string;
};

/**
 * Shop mutation helper — wires executeShopAction to the global toast provider.
 */
export function useShopAction() {
  const toast = useToast();

  const run = useCallback(
    async (
      options: UseShopActionOptions,
      fn: () => ShopActionResult | Promise<ShopActionResult>,
    ): Promise<ShopActionResult> => {
      const {
        lang,
        action,
        successKey,
        errorKey,
        permissionDeniedKey = "notifyPermissionDenied",
        ...runnerOpts
      } = options;

      return executeShopAction(
        {
          ...runnerOpts,
          permissionDeniedMessage: t(lang, permissionDeniedKey),
          onSuccess: (message) => {
            const text = message ?? shopActionSuccessMessage(lang, action, successKey);
            toast.success(text);
          },
          onError: (message) => {
            const text = shopActionErrorMessage(lang, message, errorKey);
            toast.error(text);
          },
          audit: runnerOpts.audit ?? { action },
        },
        fn,
      );
    },
    [toast],
  );

  return { run, toast };
}
