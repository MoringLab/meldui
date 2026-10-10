import { expect, test } from "@playwright/test";

test("business consumer saves only after explicit host confirmation and supports follow-up cancellation", async ({
  page,
}) => {
  await page.goto("/reservation.html");
  await page.getByRole("button", { name: "호스트 세션 시작" }).click();
  await page.getByRole("button", { name: "예약 내용 확인" }).click();
  await expect(page.getByRole("heading", { name: "서버에서 확인한 예약 내용" })).toBeVisible();
  await page.getByRole("button", { name: "확인하고 예약 저장" }).click();
  await expect(page.getByRole("status")).toContainText("예약 저장 완료");
  const cancel = page.getByRole("button", { name: "예약 취소" }).first();
  await cancel.click();
  await expect(cancel).toBeDisabled();
});
