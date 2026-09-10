// Demo coupon codes for the "Tenho um cupom de desconto" field on product.html.
// This is a prototype stand-in, not a real promo/coupon system: no usage limits,
// no expiry, no per-user restriction, no server-side validation of any kind —
// anyone can read this file and see every valid code. A real implementation
// needs this to live server-side (RecargaStore.getCouponByCode() in
// shared/js/store.js is the seam to swap for a real API call).
window.RECARGA_SEED_COUPONS = [
  { code: "BEMVINDO10", type: "percent", value: 10, label: "10% de desconto de boas-vindas" },
  { code: "RECARGA5", type: "fixed", value: 5, label: "R$ 5 de desconto" }
];
