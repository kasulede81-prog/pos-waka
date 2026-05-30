# Supabase — Reset password email template

Paste into **Supabase Dashboard → Authentication → Email Templates → Reset password**.

The link must stay as Supabase’s `{{ .ConfirmationURL }}` — it verifies the token, then redirects to your app `redirectTo` (`https://pos.waka.ug/reset-password` from the client).

---

## Subject

```
Reset your Waka POS password
```

---

## Body (HTML)

```html
<h2 style="font-family: system-ui, sans-serif; color: #1c1917;">Waka POS</h2>
<p style="font-family: system-ui, sans-serif; color: #44403c; font-size: 15px;">
  You asked to reset the password for your shop account. Tap the button below to choose a new password on Waka POS.
</p>
<p style="font-family: system-ui, sans-serif;">
  <a
    href="{{ .ConfirmationURL }}"
    style="display: inline-block; background: #ea580c; color: #ffffff; font-weight: 700; padding: 12px 20px; border-radius: 12px; text-decoration: none;"
  >Reset password</a>
</p>
<p style="font-family: system-ui, sans-serif; color: #78716c; font-size: 13px;">
  This link expires in about one hour. If you did not request a reset, you can ignore this email.
</p>
<p style="font-family: system-ui, sans-serif; color: #78716c; font-size: 13px;">
  WAKA MARKETPLACE LIMITED · Kampala, Uganda
</p>
```

---

## Plain-text fallback (optional)

Supabase may offer a separate plain template; if so:

```
Reset your Waka POS password

Open this link to set a new password (expires in about one hour):
{{ .ConfirmationURL }}

If you did not request this, ignore this email.

— Waka POS / WAKA MARKETPLACE LIMITED
```

---

## Checklist after saving

1. **Redirect URLs** include `https://pos.waka.ug/reset-password` (and staging/local).
2. **Site URL** = `https://pos.waka.ug`.
3. Send a test reset from `/forgot-password` and confirm the button opens your branded page, not a generic Supabase page.
