export function shortenAddress(address?: string | null, chars = 4): string {
    if (!address) return ''
  if (address.length < chars * 2 + 3) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}
