import { useState } from "react";
import type { FormEvent } from "react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";

export function CustomersPage({ lang }: { lang: Language }) {
  const { customers, addCustomer } = usePosStore();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    addCustomer({ name, phone, location: "Uganda" });
    setName("");
    setPhone("");
  };

  return (
    <div className="space-y-4 pb-24 md:pb-4">
      <h2 className="text-xl font-semibold">{t(lang, "customers")}</h2>
      <form onSubmit={submit} className="grid gap-2 rounded-xl border bg-white p-4 sm:grid-cols-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer name" className="rounded-lg border px-3 py-2" />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className="rounded-lg border px-3 py-2" />
        <button className="rounded-lg bg-slate-900 px-3 py-2 text-white">{t(lang, "addCustomer")}</button>
      </form>
      {customers.map((customer) => (
        <article key={customer.id} className="rounded-xl border bg-white p-3">
          <p className="font-medium">{customer.name}</p>
          <p className="text-sm text-slate-500">{customer.phone}</p>
        </article>
      ))}
    </div>
  );
}
