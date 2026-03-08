import {
  parseCidr,
  computeSubnets,
  computeAwsSubnets,
  computeAwsSraSubnets,
  cidrsOverlap,
  getUsableNodes,
} from "../../utils/cidr";

// ---------------------------------------------------------------------------
// parseCidr
// ---------------------------------------------------------------------------
describe("parseCidr", () => {
  it("parses a valid /16 CIDR", () => {
    const result = parseCidr("10.0.0.0/16");
    expect(result).not.toBeNull();
    expect(result!.prefixLen).toBe(16);
    expect(result!.networkAddr).toBe((10 << 24) >>> 0);
  });

  it("parses a valid /24 CIDR", () => {
    const result = parseCidr("192.168.1.0/24");
    expect(result).not.toBeNull();
    expect(result!.prefixLen).toBe(24);
    expect(result!.networkAddr).toBe(((192 << 24) | (168 << 16) | (1 << 8)) >>> 0);
  });

  it("parses /0 (entire IPv4 space)", () => {
    const result = parseCidr("0.0.0.0/0");
    expect(result).not.toBeNull();
    expect(result!.prefixLen).toBe(0);
    expect(result!.networkAddr).toBe(0);
  });

  it("parses /32 (single host)", () => {
    const result = parseCidr("10.0.0.1/32");
    expect(result).not.toBeNull();
    expect(result!.prefixLen).toBe(32);
  });

  it("trims whitespace", () => {
    expect(parseCidr("  10.0.0.0/16  ")).not.toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseCidr("")).toBeNull();
  });

  it("returns null for non-string input", () => {
    expect(parseCidr(42 as unknown as string)).toBeNull();
  });

  it("returns null for missing prefix", () => {
    expect(parseCidr("10.0.0.0")).toBeNull();
  });

  it("returns null for octet > 255", () => {
    expect(parseCidr("256.0.0.0/16")).toBeNull();
  });

  it("returns null for prefix > 32", () => {
    expect(parseCidr("10.0.0.0/33")).toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(parseCidr("not-a-cidr")).toBeNull();
    expect(parseCidr("10.0.0/16")).toBeNull();
    expect(parseCidr("10.0.0.0.0/16")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeSubnets (Azure VNet → public + private)
// ---------------------------------------------------------------------------
describe("computeSubnets", () => {
  it("splits a /20 VNet into two /22 subnets", () => {
    const result = computeSubnets("10.0.0.0/20");
    expect(result).not.toBeNull();
    expect(result!.publicCidr).toBe("10.0.0.0/22");
    expect(result!.privateCidr).toBe("10.0.4.0/22");
  });

  it("splits a /16 VNet into two /18 subnets", () => {
    const result = computeSubnets("10.0.0.0/16");
    expect(result).not.toBeNull();
    expect(result!.publicCidr).toBe("10.0.0.0/18");
    expect(result!.privateCidr).toBe("10.0.64.0/18");
  });

  it("splits a /24 VNet into two /26 subnets", () => {
    const result = computeSubnets("192.168.1.0/24");
    expect(result).not.toBeNull();
    expect(result!.publicCidr).toBe("192.168.1.0/26");
    expect(result!.privateCidr).toBe("192.168.1.64/26");
  });

  it("returns null for prefix >= 29 (too small to split)", () => {
    expect(computeSubnets("10.0.0.0/29")).toBeNull();
    expect(computeSubnets("10.0.0.0/30")).toBeNull();
    expect(computeSubnets("10.0.0.0/32")).toBeNull();
  });

  it("returns null for invalid CIDR", () => {
    expect(computeSubnets("invalid")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeAwsSubnets (VPC → 2 private + 1 public /28)
// ---------------------------------------------------------------------------
describe("computeAwsSubnets", () => {
  it("computes correct subnets for a /16 VPC", () => {
    const result = computeAwsSubnets("10.4.0.0/16");
    expect(result).not.toBeNull();
    expect(result!.private1Cidr).toBe("10.4.0.0/18");
    expect(result!.private2Cidr).toBe("10.4.64.0/18");
    expect(result!.publicCidr).toBe("10.4.128.0/28");
  });

  it("computes correct subnets for a /20 VPC", () => {
    const result = computeAwsSubnets("10.0.0.0/20");
    expect(result).not.toBeNull();
    expect(result!.private1Cidr).toBe("10.0.0.0/22");
    expect(result!.private2Cidr).toBe("10.0.4.0/22");
    expect(result!.publicCidr).toBe("10.0.8.0/28");
  });

  it("returns null for prefix >= 26 (too small)", () => {
    expect(computeAwsSubnets("10.0.0.0/26")).toBeNull();
    expect(computeAwsSubnets("10.0.0.0/28")).toBeNull();
  });

  it("returns null for invalid CIDR", () => {
    expect(computeAwsSubnets("bad")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeAwsSraSubnets (VPC → 2 private + 2 PrivateLink /28)
// ---------------------------------------------------------------------------
describe("computeAwsSraSubnets", () => {
  it("computes correct subnets for a /16 VPC", () => {
    const result = computeAwsSraSubnets("10.0.0.0/16");
    expect(result).not.toBeNull();
    expect(result!.private1).toBe("10.0.0.0/18");
    expect(result!.private2).toBe("10.0.64.0/18");
    expect(result!.privatelink1).toBe("10.0.128.0/28");
    expect(result!.privatelink2).toBe("10.0.128.16/28");
  });

  it("computes correct subnets for a /20 VPC", () => {
    const result = computeAwsSraSubnets("10.0.0.0/20");
    expect(result).not.toBeNull();
    expect(result!.private1).toBe("10.0.0.0/22");
    expect(result!.private2).toBe("10.0.4.0/22");
    expect(result!.privatelink1).toBe("10.0.8.0/28");
    expect(result!.privatelink2).toBe("10.0.8.16/28");
  });

  it("returns null for prefix >= 26", () => {
    expect(computeAwsSraSubnets("10.0.0.0/26")).toBeNull();
  });

  it("returns null for invalid CIDR", () => {
    expect(computeAwsSraSubnets("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// cidrsOverlap
// ---------------------------------------------------------------------------
describe("cidrsOverlap", () => {
  it("detects overlap when one range is inside another", () => {
    expect(cidrsOverlap("10.0.0.0/16", "10.0.1.0/24")).toBe(true);
  });

  it("detects overlap for identical ranges", () => {
    expect(cidrsOverlap("10.0.0.0/24", "10.0.0.0/24")).toBe(true);
  });

  it("returns false for non-overlapping ranges", () => {
    expect(cidrsOverlap("10.0.0.0/24", "10.0.1.0/24")).toBe(false);
  });

  it("returns false for completely separate ranges", () => {
    expect(cidrsOverlap("10.0.0.0/16", "172.16.0.0/16")).toBe(false);
  });

  it("detects partial overlap at boundary", () => {
    expect(cidrsOverlap("10.0.0.0/20", "10.0.8.0/22")).toBe(true);
  });

  it("returns false when first range is invalid", () => {
    expect(cidrsOverlap("invalid", "10.0.0.0/24")).toBe(false);
  });

  it("returns false when second range is invalid", () => {
    expect(cidrsOverlap("10.0.0.0/24", "invalid")).toBe(false);
  });

  it("returns false when both ranges are invalid", () => {
    expect(cidrsOverlap("invalid", "also-invalid")).toBe(false);
  });

  it("handles /0 overlapping with everything", () => {
    expect(cidrsOverlap("0.0.0.0/0", "192.168.1.0/24")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getUsableNodes
// ---------------------------------------------------------------------------
describe("getUsableNodes", () => {
  it("returns 0 for /31 (only 2 IPs, minus 5 reserved = negative)", () => {
    expect(getUsableNodes(31)).toBe(0);
  });

  it("returns 0 for /32 (single IP)", () => {
    expect(getUsableNodes(32)).toBe(0);
  });

  it("calculates correct node count for /22 (1024 IPs)", () => {
    // (1024 - 5) / 2 = 509.5 → floor = 509
    expect(getUsableNodes(22)).toBe(509);
  });

  it("calculates correct node count for /24 (256 IPs)", () => {
    // (256 - 5) / 2 = 125.5 → floor = 125
    expect(getUsableNodes(24)).toBe(125);
  });

  it("calculates correct node count for /28 (16 IPs)", () => {
    // (16 - 5) / 2 = 5.5 → floor = 5
    expect(getUsableNodes(28)).toBe(5);
  });

  it("calculates correct node count for /16 (65536 IPs)", () => {
    // (65536 - 5) / 2 = 32765.5 → floor = 32765
    expect(getUsableNodes(16)).toBe(32765);
  });

  it("returns 0 for /30 (4 IPs, minus 5 reserved = negative, clamped to 0)", () => {
    // (4 - 5) / 2 = -0.5 → floor = -1 → max(0, -1) = 0
    expect(getUsableNodes(30)).toBe(0);
  });
});
