import type {
  ProductRequest,
  ProductRow,
  ResearchBlock,
  ResearchKind,
  ResearchPersona,
} from "./types";
import { RESEARCH_KINDS, getProductRequest, getResearchState } from "./types";

export type ResearchInput = {
  title: string;
  request: ProductRequest;
  sellingPrice: number | null;
  clientPrice: number | null;
};

function markets(request: ProductRequest) {
  const raw = request.destination_markets?.trim();
  return raw && raw.length > 0 ? raw : "your main markets";
}

function money(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return null;
  return `$${value.toFixed(2)}`;
}

export function buildResearchBlock(kind: ResearchKind, input: ResearchInput): ResearchBlock {
  const now = new Date().toISOString();
  const name = input.title.trim() || "This product";
  const description = input.request.description?.trim();
  const notes = input.request.notes?.trim();
  const target = money(input.request.target_unit_price);
  const sell = money(input.sellingPrice);
  const cogs = money(input.clientPrice);
  const qty = input.request.expected_launch_qty;
  const source = input.request.source_url?.trim();
  const dest = markets(input.request);

  if (kind === "brief") {
    const bullets = [
      description || `${name} is in testing. Use this brief as the working spec for sourcing and ads.`,
      target
        ? `Target unit cost: ${target}.`
        : "No target unit cost yet — add one on the product request if you have a ceiling.",
      sell
        ? `Planned selling price: ${sell}${cogs ? ` (current COGS ${cogs})` : ""}.`
        : "Add a selling price above to lock positioning and ROAS.",
      qty ? `Expected launch quantity: ${qty}.` : `First drop should stay small so you can test ${dest}.`,
      notes ? `Client notes: ${notes}` : `Priority markets: ${dest}.`,
    ];
    if (source) bullets.push(`Reference link: ${source}`);

    return {
      status: "ready",
      requested_at: now,
      ready_at: now,
      title: `${name} — product brief`,
      summary: `${name} is positioned for ${dest}. This brief is ready to share with sourcing and creative.`,
      bullets,
    };
  }

  if (kind === "reddit") {
    return {
      status: "ready",
      requested_at: now,
      ready_at: now,
      title: `${name} — shopper research`,
      summary: `First-pass research for ${name}. These are the questions and objections shoppers usually raise before they buy a product like this.`,
      bullets: [
        `What problem does ${name} actually solve, and why is this version better than the cheap alternative?`,
        "People ask for real measurements, materials, and what breaks after 30 days — not lifestyle copy.",
        sell
          ? `At ${sell}, buyers compare perceived quality vs price. Lead with proof, not discounts.`
          : "Price is still open. Shoppers will bounce if the offer is not specific.",
        `Delivery and returns for ${dest} come up in the first comments. State transit time and who handles defects.`,
        description
          ? `From your brief: ${description}`
          : "Add a tighter description so the next refresh can go deeper on use cases.",
      ],
    };
  }

  const cards: ResearchPersona[] = [
    {
      name: "The tester",
      role: "First-order buyer",
      need: `Wants a low-risk first unit of ${name} to see if it is worth scaling.`,
      hook: "Small launch qty, clear specs, and a refund path.",
    },
    {
      name: "The gift buyer",
      role: "One-time purchaser",
      need: "Needs a simple reason this is a good gift, plus fast delivery.",
      hook: `Lead with the outcome, then ship time to ${dest}.`,
    },
    {
      name: "The value hunter",
      role: "Compares three tabs",
      need: "Will only convert if quality and price are explicit.",
      hook: target
        ? `Hold the line near a ${target} unit cost so the offer stays credible.`
        : "Show what is included and what is not. Avoid vague “premium” language.",
    },
  ];

  return {
    status: "ready",
    requested_at: now,
    ready_at: now,
    title: `${name} — personas`,
    summary: `Three buyer cards for ${name}. Use them for ads, landing copy, and the first creative test.`,
    cards,
  };
}

export function researchInputFromProduct(product: ProductRow): ResearchInput {
  return {
    title: product.title,
    request: getProductRequest(product),
    sellingPrice: product.selling_price,
    clientPrice: product.client_price,
  };
}

export function isResearchIncomplete(product: ProductRow) {
  const state = getResearchState(product);
  return RESEARCH_KINDS.some((kind) => {
    const block = state[kind];
    return block.status === "generating" && !block.summary && !block.cards?.length;
  });
}

export function completeResearchState(product: ProductRow) {
  const current = getResearchState(product);
  const input = researchInputFromProduct(product);
  const next: Record<ResearchKind, ResearchBlock> = { ...current };
  for (const kind of RESEARCH_KINDS) {
    const block = current[kind];
    if (block.status === "generating" && !block.summary && !block.cards?.length) {
      next[kind] = buildResearchBlock(kind, input);
    }
  }
  return next;
}
