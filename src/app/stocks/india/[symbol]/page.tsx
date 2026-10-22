import StockFullPage from "@/components/stock/StockFullPage";

// /stocks/india/JSWSTEEL.NS - Screener-style fundamentals (₹ crores).
export default function IndiaStockPage({ params }: { params: { symbol: string } }) {
  return <StockFullPage market="india" rawSymbol={params.symbol} />;
}
