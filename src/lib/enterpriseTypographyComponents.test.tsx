import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Display, PageTitle, SectionTitle, Body, Caption, MonoNumber } from "../components/enterprise/EnterpriseTypography";
import { enterpriseTypeClass } from "./enterpriseTypography";

describe("EnterpriseTypography components", () => {
  it("renders semantic roles with enterprise classes", () => {
    expect(renderToStaticMarkup(<PageTitle>Dashboard</PageTitle>)).toContain(enterpriseTypeClass("pageTitle"));
    expect(renderToStaticMarkup(<SectionTitle>Section</SectionTitle>)).toContain(enterpriseTypeClass("sectionTitle"));
    expect(renderToStaticMarkup(<Caption>Label</Caption>)).toContain(enterpriseTypeClass("caption"));
    expect(renderToStaticMarkup(<MonoNumber>1,250</MonoNumber>)).toContain(enterpriseTypeClass("monoNumber"));
    expect(renderToStaticMarkup(<Display>Hero</Display>)).toContain(enterpriseTypeClass("display"));
    expect(renderToStaticMarkup(<Body>Text</Body>)).toContain(enterpriseTypeClass("body"));
  });
});
