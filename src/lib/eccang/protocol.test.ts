import { describe, expect, it } from "vitest";
import {
  buildEnvelope,
  eccangEndpoint,
  errorMessage,
  parseResponse,
  unescapeXml,
} from "./protocol";

const creds = { appKey: "voltship-key", appToken: "s3cr3t&token" };

describe("buildEnvelope", () => {
  it("builds the ns1:callService envelope with paramsJson, appToken, appKey, service", () => {
    const xml = buildEnvelope({
      credentials: creds,
      service: "getWarehouse",
      params: { pageSize: 10, note: "a<b" },
    });
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('xmlns:ns1="http://www.example.org/Ec/"');
    expect(xml).toContain("<ns1:callService>");
    expect(xml).toContain("<service>getWarehouse</service>");
    expect(xml).toContain("<appKey>voltship-key</appKey>");
    expect(xml).toContain("<appToken>s3cr3t&amp;token</appToken>");
    expect(xml).toContain("<language>en_US</language>");
    // paramsJson is a JSON string, XML-escaped
    expect(xml).toContain("<paramsJson>{&quot;pageSize&quot;:10,&quot;note&quot;:&quot;a&lt;b&quot;}</paramsJson>");
  });

  it("serialises empty params as {}", () => {
    const xml = buildEnvelope({ credentials: creds, service: "getWarehouse", params: undefined });
    expect(xml).toContain("<paramsJson>{}</paramsJson>");
  });
});

describe("eccangEndpoint", () => {
  it("normalises bare hosts and URLs", () => {
    expect(eccangEndpoint("wms.example.com")).toBe("http://wms.example.com/default/svc/web-service");
    expect(eccangEndpoint("https://wms.example.com/")).toBe("https://wms.example.com/default/svc/web-service");
    expect(eccangEndpoint("http://wms.example.com/default/svc/web-service")).toBe(
      "http://wms.example.com/default/svc/web-service",
    );
  });
});

describe("parseResponse", () => {
  const wrap = (inner: string) =>
    `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="http://www.example.org/Ec/">
  <SOAP-ENV:Body>
    <ns1:callServiceResponse>
      <response>${inner}</response>
    </ns1:callServiceResponse>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

  it("parses an XML-escaped Success payload with data and pagination", () => {
    const json = JSON.stringify({
      ask: "Success",
      message: "ok",
      data: [{ warehouse_code: "SZ01", warehouse_name: "深圳仓 <A>" }],
      count: 1,
      nextPage: "false",
    });
    const xml = wrap(json.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"));
    const parsed = parseResponse<Array<{ warehouse_code: string; warehouse_name: string }>>(xml);
    expect(parsed.ask).toBe("Success");
    expect(parsed.data?.[0].warehouse_code).toBe("SZ01");
    expect(parsed.data?.[0].warehouse_name).toBe("深圳仓 <A>");
    expect(parsed.nextPage).toBe("false");
  });

  it("parses a CDATA payload", () => {
    const xml = wrap(`<![CDATA[{"ask":"Success","order_code":"OC123","tracking_no":""}]]>`);
    const parsed = parseResponse(xml);
    expect(parsed.ask).toBe("Success");
    expect(parsed.order_code).toBe("OC123");
  });

  it("normalises Failure and exposes errCode / errMessage", () => {
    const xml = wrap(
      `{&quot;ask&quot;:&quot;Failure&quot;,&quot;message&quot;:&quot;sku exists&quot;,&quot;Error&quot;:{&quot;errCode&quot;:&quot;E1001&quot;,&quot;errMessage&quot;:&quot;SKU已存在&quot;}}`,
    );
    const parsed = parseResponse(xml);
    expect(parsed.ask).toBe("Failure");
    expect(parsed.Error?.errCode).toBe("E1001");
    expect(errorMessage(parsed)).toBe("E1001: SKU已存在");
  });

  it("maps a SOAP Fault to Failure", () => {
    const xml = `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><SOAP-ENV:Fault><faultcode>SOAP-ENV:Server</faultcode><faultstring>Invalid appToken</faultstring></SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
    const parsed = parseResponse(xml);
    expect(parsed.ask).toBe("Failure");
    expect(parsed.Error?.errCode).toBe("SOAP_FAULT");
    expect(parsed.message).toBe("Invalid appToken");
  });

  it("accepts a raw JSON body (no SOAP wrapper)", () => {
    const parsed = parseResponse(`{"ask":"Success","data":{"a":1}}`);
    expect(parsed.ask).toBe("Success");
    expect((parsed.data as { a: number }).a).toBe(1);
  });

  it("throws on non-JSON content", () => {
    expect(() => parseResponse("<html>502 Bad Gateway</html>")).toThrow(/JSON/);
  });
});

describe("unescapeXml", () => {
  it("handles named and numeric entities", () => {
    expect(unescapeXml("a&lt;b&gt;c&amp;d&quot;e&apos;f&#65;&#x42;")).toBe(`a<b>c&d"e'fAB`);
  });
});
