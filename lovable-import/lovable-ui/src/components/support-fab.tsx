import { LifeBuoy } from "lucide-react";

export function SupportFAB() {
  return (
    <a
      href="https://wa.me/256700000000?text=Hello%20Waka%20POS%20support"
      target="_blank"
      rel="noreferrer"
      aria-label="Get help"
      className="fixed bottom-24 right-4 z-40 grid h-14 w-14 place-items-center rounded-full bg-waka-600 text-primary-foreground shadow-lg shadow-waka-600/30 hover:bg-waka-700 md:bottom-8"
    >
      <LifeBuoy className="h-6 w-6" />
    </a>
  );
}
