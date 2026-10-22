import StockFullPage from "@/components/stock/StockFullPage";

// /stocks/us/AAPL - same Screener-style view, amounts in $ millions.
export default function UsStockPage({ params }: { params: { symbol: string } }) {
  return <StockFullPage market="us" rawSymbol={params.symbol} />;
}
