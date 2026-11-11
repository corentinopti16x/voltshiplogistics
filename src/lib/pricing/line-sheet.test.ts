import { describe, expect, it } from "vitest";
import { parseLineSheet } from "./line-sheet";

describe("parseLineSheet", () => {
  it("groups the tiers of a line and skips the header", () => {
    const { entries, problems } = parseLineSheet(
      [
        "pays\ttype\ttransporteur\tligne\tjusqu_a_g\tyuan_par_kilo\tyuan_par_colis\tminimum_facture_g\tetat\tligne_eccang\tdelai_jours\tcommentaire",
        "CA\tstandard\tTongyou\t加拿大专线特货\t500\t75\t20\t\tactive\tCA_BAT_TY\t8-12\tValeur déclarée 5 à 14 $",
        "CA\tstandard\tTongyou\t加拿大专线特货\t99\t93\t21",
        "ca\tstandard\tTongyou\t加拿大专线特货\t1000\t75\t23",
      ].join("\n"),
    );
    expect(problems).toEqual([]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      destination: "CA",
      channel: "standard",
      carrier: "Tongyou",
      lineName: "加拿大专线特货",
      status: "active",
      eccangMethod: "CA_BAT_TY",
      deliveryDays: "8-12",
      note: "Valeur déclarée 5 à 14 $",
    });
    expect(entries[0].price.tiers.map((tier) => tier.maxG)).toEqual([
      99, 500, 1000,
    ]);
  });

  it("reads semicolons, decimal commas and French type names", () => {
    const { entries } = parseLineSheet(
      "CH;batterie;Tongyou;纯电;2000;126;21,5;;à ouvrir",
    );
    expect(entries[0]).toMatchObject({
      channel: "electronics_battery",
      status: "pending",
      eccangMethod: null,
    });
    expect(entries[0].price.tiers[0].feeRmb).toBe(21.5);
  });

  it("reports the row of each problem and keeps the good lines", () => {
    const { entries, problems } = parseLineSheet(
      [
        "FR;standard;Wanb;EUSLPH-P;400;70;24",
        "France;standard;Wanb;X;400;70;24",
        "FR;parfum;Wanb;X;400;70;24",
        "FR;standard;Wanb;Y;400;0;0",
        "FR;standard;Wanb;Z;400;70;24;;fermée",
        "FR;standard",
      ].join("\n"),
    );
    expect(entries).toHaveLength(1);
    expect(problems).toEqual([
      { row: 2, code: "country" },
      { row: 3, code: "type" },
      { row: 4, code: "amounts" },
      { row: 5, code: "status" },
      { row: 6, code: "columns" },
    ]);
  });
});
