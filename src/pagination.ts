export const pageSize = 12;
export const maxOffset = 996;
export function totalPages(total: number) {
  return Math.max(1, Math.min(Math.ceil(total / pageSize), Math.floor(maxOffset / pageSize) + 1));
}
export function visiblePages(current: number, total: number) {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, 0, total];
  if (current >= total - 3) return [1, 0, total - 4, total - 3, total - 2, total - 1, total];
  return [1, 0, current - 1, current, current + 1, 0, total];
}
