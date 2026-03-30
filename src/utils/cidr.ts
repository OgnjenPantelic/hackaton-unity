const RESERVED_IPS_PER_SUBNET = 5;

export function parseCidr(cidr: string): { networkAddr: number; prefixLen: number } | null {
  if (typeof cidr !== "string") return null;
  const match = cidr.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/);
  if (!match) return null;

  const octets = [parseInt(match[1]), parseInt(match[2]), parseInt(match[3]), parseInt(match[4])];
  const prefixLen = parseInt(match[5]);

  if (octets.some(o => o < 0 || o > 255) || prefixLen < 0 || prefixLen > 32) return null;

  const networkAddr = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
  return { networkAddr, prefixLen };
}

function intToIp(addr: number): string {
  return `${(addr >>> 24) & 0xff}.${(addr >>> 16) & 0xff}.${(addr >>> 8) & 0xff}.${addr & 0xff}`;
}

/**
 * Compute two subnets from a VNet CIDR, each 2 prefix lengths smaller.
 * E.g. /20 VNet → two /22 subnets, leaving 50% of the address space free.
 */
export function computeSubnets(vnetCidr: string): { publicCidr: string; privateCidr: string } | null {
  const parsed = parseCidr(vnetCidr);
  if (!parsed || parsed.prefixLen >= 29) return null;

  const subnetPrefix = parsed.prefixLen + 2;
  const subnetSize = Math.pow(2, 32 - subnetPrefix);

  return {
    publicCidr: `${intToIp(parsed.networkAddr)}/${subnetPrefix}`,
    privateCidr: `${intToIp((parsed.networkAddr + subnetSize) >>> 0)}/${subnetPrefix}`,
  };
}

/**
 * Compute Azure PL subnets from a VNet CIDR:
 * - 2 workspace subnets (public, private) each at VNet prefix + 8 bits (e.g. /16 → /24)
 * - 1 private endpoint subnet at /26 placed after the workspace subnets
 */
export function computeAzurePlSubnets(vnetCidr: string): {
  publicCidr: string;
  privateCidr: string;
  privateEndpointCidr: string;
} | null {
  const parsed = parseCidr(vnetCidr);
  if (!parsed || parsed.prefixLen > 24) return null;

  const wsPrefix = Math.min(parsed.prefixLen + 2, 26);
  const wsSize = Math.pow(2, 32 - wsPrefix);

  const publicStart = parsed.networkAddr;
  const privateStart = (publicStart + wsSize) >>> 0;
  const peStart = (privateStart + wsSize) >>> 0;

  return {
    publicCidr: `${intToIp(publicStart)}/${wsPrefix}`,
    privateCidr: `${intToIp(privateStart)}/${wsPrefix}`,
    privateEndpointCidr: `${intToIp(peStart)}/26`,
  };
}

/**
 * Compute AWS subnets from a VPC CIDR:
 * - 2 private subnets at VPC+2 (each 1/4 of VPC, for Databricks compute)
 * - 1 public /28 subnet for NAT gateway, placed at the VPC midpoint
 */
export function computeAwsSubnets(vpcCidr: string): {
  private1Cidr: string;
  private2Cidr: string;
  publicCidr: string;
} | null {
  const parsed = parseCidr(vpcCidr);
  if (!parsed || parsed.prefixLen >= 26) return null;

  const subnetPrefix = parsed.prefixLen + 2;
  const subnetSize = Math.pow(2, 32 - subnetPrefix);
  const midpoint = (parsed.networkAddr + subnetSize * 2) >>> 0;

  return {
    private1Cidr: `${intToIp(parsed.networkAddr)}/${subnetPrefix}`,
    private2Cidr: `${intToIp((parsed.networkAddr + subnetSize) >>> 0)}/${subnetPrefix}`,
    publicCidr: `${intToIp(midpoint)}/28`,
  };
}

/**
 * Compute AWS SRA subnets from a VPC CIDR:
 * - 2 private subnets at VPC+2 (each 1/4 of VPC, for Databricks compute)
 * - 2 PrivateLink subnets at /28, placed after the private subnets
 */
export function computeAwsSraSubnets(vpcCidr: string): {
  private1: string;
  private2: string;
  privatelink1: string;
  privatelink2: string;
} | null {
  const parsed = parseCidr(vpcCidr);
  if (!parsed || parsed.prefixLen >= 26) return null;

  const subnetPrefix = parsed.prefixLen + 2;
  const subnetSize = Math.pow(2, 32 - subnetPrefix);
  const plBase = (parsed.networkAddr + subnetSize * 2) >>> 0;
  const plSubnetSize = Math.pow(2, 32 - 28);

  return {
    private1: `${intToIp(parsed.networkAddr)}/${subnetPrefix}`,
    private2: `${intToIp((parsed.networkAddr + subnetSize) >>> 0)}/${subnetPrefix}`,
    privatelink1: `${intToIp(plBase)}/28`,
    privatelink2: `${intToIp((plBase + plSubnetSize) >>> 0)}/28`,
  };
}

/**
 * Check whether two CIDR ranges overlap.
 */
export function cidrsOverlap(cidr1: string, cidr2: string): boolean {
  const a = parseCidr(cidr1);
  const b = parseCidr(cidr2);
  if (!a || !b) return false;

  const aMask = a.prefixLen === 0 ? 0 : (~(Math.pow(2, 32 - a.prefixLen) - 1)) >>> 0;
  const bMask = b.prefixLen === 0 ? 0 : (~(Math.pow(2, 32 - b.prefixLen) - 1)) >>> 0;

  const aNet = (a.networkAddr & aMask) >>> 0;
  const bNet = (b.networkAddr & bMask) >>> 0;

  return ((aNet & bMask) >>> 0) === bNet || ((bNet & aMask) >>> 0) === aNet;
}

/**
 * Each node requires 2 private IPs, and 5 IPs are reserved per subnet.
 * nodes = floor((totalIPs - 5) / 2)
 */
export function getUsableNodes(prefixLen: number): number {
  if (prefixLen >= 31) return 0;
  const totalIps = Math.pow(2, 32 - prefixLen);
  return Math.max(0, Math.floor((totalIps - RESERVED_IPS_PER_SUBNET) / 2));
}
