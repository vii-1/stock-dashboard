import { redirect } from "next/navigation";

// Angel One lives on the shared Broker Connect page - kept so old links work.
export default function AngelPage() {
  redirect("/brokers#angel");
}
