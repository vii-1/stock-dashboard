import { redirect } from "next/navigation";

// Kite moved into the shared Broker Connect page - kept so old links work.
export default function KitePage() {
  redirect("/brokers#kite");
}
