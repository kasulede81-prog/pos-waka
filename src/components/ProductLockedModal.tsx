import { Link } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { ModalSheet } from "./layout/ModalSheet";
import { WakaButton } from "./ui/wakaPrimitives";
import { Body } from "./enterprise/EnterpriseTypography";

type Props = {
  lang: Language;
  open: boolean;
  onClose: () => void;
};

export function ProductLockedModal({ lang, open, onClose }: Props) {
  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      align="center"
      zIndexClass="z-[80]"
      maxHeightClass="max-h-[min(88dvh,480px)]"
      panelClassName="max-w-sm"
      title={t(lang, "productLockedTitle")}
      footer={
        <div className="grid gap-2">
          <Link to="/upgrade" onClick={onClose}>
            <WakaButton type="button" className="w-full">
              {t(lang, "productLockedUpgrade")}
            </WakaButton>
          </Link>
          <WakaButton type="button" variant="secondary" className="w-full" onClick={onClose}>
            {t(lang, "cancel")}
          </WakaButton>
        </div>
      }
    >
      <Body className="text-muted-foreground">{t(lang, "productLockedBody")}</Body>
    </ModalSheet>
  );
}
