import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { enterpriseTypeClass, type EnterpriseTypeRole } from "../../lib/enterpriseTypography";

type TypographyProps = {
  as?: ElementType;
  className?: string;
  children?: ReactNode;
};

type TypographyHtmlProps = TypographyProps &
  Omit<HTMLAttributes<HTMLElement>, keyof TypographyProps | "role">;

function Typography({
  typeRole,
  as,
  className,
  children,
  ...props
}: TypographyProps & { typeRole: EnterpriseTypeRole } & Omit<HTMLAttributes<HTMLElement>, keyof TypographyProps | "role">) {
  const Tag = (as ?? defaultTagForRole(typeRole)) as ElementType;
  return (
    <Tag className={enterpriseTypeClass(typeRole, className)} {...props}>
      {children}
    </Tag>
  );
}

function defaultTagForRole(typeRole: EnterpriseTypeRole): ElementType {
  switch (typeRole) {
    case "display":
    case "pageTitle":
      return "h1";
    case "sectionTitle":
      return "h2";
    case "body":
      return "p";
    case "caption":
      return "span";
    default:
      return "span";
  }
}

export function Display({ as = "h1", className, children, ...props }: TypographyHtmlProps) {
  return (
    <Typography typeRole="display" as={as} className={className} {...props}>
      {children}
    </Typography>
  );
}

export function PageTitle({ as = "h1", className, children, ...props }: TypographyHtmlProps) {
  return (
    <Typography typeRole="pageTitle" as={as} className={className} {...props}>
      {children}
    </Typography>
  );
}

export function SectionTitle({ as = "h2", className, children, ...props }: TypographyHtmlProps) {
  return (
    <Typography typeRole="sectionTitle" as={as} className={className} {...props}>
      {children}
    </Typography>
  );
}

export function Body({ as = "p", className, children, ...props }: TypographyHtmlProps) {
  return (
    <Typography typeRole="body" as={as} className={className} {...props}>
      {children}
    </Typography>
  );
}

export function Caption({ as = "span", className, children, ...props }: TypographyHtmlProps) {
  return (
    <Typography typeRole="caption" as={as} className={className} {...props}>
      {children}
    </Typography>
  );
}

export function MonoNumber({ as = "span", className, children, ...props }: TypographyHtmlProps) {
  return (
    <Typography typeRole="monoNumber" as={as} className={className} {...props}>
      {children}
    </Typography>
  );
}
