import { MyOrderList } from "./my-order-list";

export default function MyOrdersPage() {
  return (
    <main className="page flex-1 pb-12 pt-2">
      <h1 className="title mb-8">내 주문</h1>
      <MyOrderList />
    </main>
  );
}