export default function ShopLayout({ children, modal }: LayoutProps<"/shop">) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}
