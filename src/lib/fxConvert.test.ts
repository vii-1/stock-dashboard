import { describe, expect, it } from "vitest";
import { nativeCurrency, toNativeUnitPrice } from "./fxConvert";

describe("nativeCurrency", () => {
  it("is INR for Indian stocks and USD for everything else", () => {
    expect(nativeCurrency("IN_STOCK")).toBe("INR");
    expect(nativeCurrency("US_STOCK")).toBe("USD");
    expect(nativeCurrency("CRYPTO")).toBe("USD");
  });
});

describe("toNativeUnitPrice", () => {
  it("passes a same-currency per-unit price through unchanged", () => {
    expect(
      toNativeUnitPrice({ amount: 150, mode: "PER_UNIT", quantity: 3, inputCurrency: "USD", native: "USD", usdInr: null })
    ).toBe(150);
  });

  it("divides a total by quantity", () => {
    expect(
      toNativeUnitPrice({ amount: 300, mode: "TOTAL", quantity: 3, inputCurrency: "INR", native: "INR", usdInr: null })
    ).toBe(100);
  });

  it("converts a rupee per-unit price into dollars", () => {
    expect(
      toNativeUnitPrice({ amount: 9400, mode: "PER_UNIT", quantity: 1, inputCurrency: "INR", native: "USD", usdInr: 94 })
    ).toBeCloseTo(100);
  });

  it("converts a rupee total for a fractional crypto quantity", () => {
    // ₹1,400 for 0.0002 BTC at ₹94/$ -> ₹70,00,000/BTC -> ~$74,468/BTC
    const price = toNativeUnitPrice({
      amount: 1400,
      mode: "TOTAL",
      quantity: 0.0002,
      inputCurrency: "INR",
      native: "USD",
      usdInr: 94,
    });
    expect(price).toBeCloseTo(7_000_000 / 94, 2);
  });

  it("refuses to convert without a rate", () => {
    expect(() =>
      toNativeUnitPrice({ amount: 100, mode: "PER_UNIT", quantity: 1, inputCurrency: "INR", native: "USD", usdInr: null })
    ).toThrow(/rate unavailable/);
  });
});
