import {
  createSession,
  checkSession,
  verifyPhone,
  HttpError,
  _clearRegistry,
} from "../services/verifyMn";

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const FUTURE = new Date(Date.now() + 300_000).toISOString();

function okJson(data: unknown) {
  return { ok: true, json: async () => data, text: async () => "" };
}
function errResponse(status: number, body: unknown = "") {
  return {
    ok: false,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

function mockSession(sessionId = "sess_abc") {
  return okJson({
    sessionId, phone: "99887766", shortcode: "144773",
    text: "482916", smsUri: "sms:144773?body=482916",
    displayInstruction: "144773 дугаарт 482916 илгээнэ үү",
    expiresAt: FUTURE,
  });
}

function mockStatus(status: "PENDING" | "VERIFIED" | "EXPIRED") {
  return okJson({
    sessionId: "sess_abc", phone: "99887766",
    sessionStatus: status, callbackStatus: "PENDING",
    verifiedAt: status === "VERIFIED" ? new Date().toISOString() : null,
    expiresAt: FUTURE,
  });
}

beforeEach(() => { mockFetch.mockReset(); _clearRegistry(); jest.useFakeTimers(); });
afterEach(() => jest.useRealTimers());

test("createSession POSTs with Authorization header", async () => {
  mockFetch.mockResolvedValueOnce(mockSession());
  const res = await createSession("99887766");
  const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
  expect(url).toContain("/sessions");
  expect((init.headers as Record<string, string>)["Authorization"]).toMatch(/^Bearer /);
  expect(res.sessionId).toBe("sess_abc");
});

test("createSession never logs the API key", async () => {
  const spy = jest.spyOn(console, "log").mockImplementation(() => {});
  mockFetch.mockResolvedValueOnce(mockSession());
  await createSession("99887766");
  for (const call of spy.mock.calls) {
    expect(JSON.stringify(call)).not.toContain("test_api_key");
  }
  spy.mockRestore();
});

test("checkSession returns sessionStatus", async () => {
  mockFetch.mockResolvedValueOnce(mockStatus("VERIFIED"));
  const res = await checkSession("sess_abc");
  expect(res.sessionStatus).toBe("VERIFIED");
  expect(res.verifiedAt).toBeTruthy();
});

test("HttpError thrown on 500", async () => {
  mockFetch.mockResolvedValueOnce(errResponse(500));
  await expect(checkSession("sess_abc")).rejects.toBeInstanceOf(HttpError);
});

test("401 error extracts message from JSON body", async () => {
  mockFetch.mockResolvedValueOnce(
    errResponse(401, { message: "API KEY буруу эсвэл хүчингүй болсон." })
  );
  await expect(createSession("99887766")).rejects.toThrow("API KEY буруу");
});

test("verifyPhone returns true when PENDING → VERIFIED", async () => {
  mockFetch.mockResolvedValueOnce(mockSession());
  mockFetch.mockResolvedValueOnce(mockStatus("PENDING"));
  mockFetch.mockResolvedValueOnce(mockStatus("VERIFIED"));

  const promise = verifyPhone("99887766");
  await jest.advanceTimersByTimeAsync(3_000);
  await jest.advanceTimersByTimeAsync(3_000);
  expect(await promise).toBe(true);
});

test("verifyPhone returns false when session expires", async () => {
  const expiresAt = new Date(Date.now() + 50).toISOString();
  mockFetch.mockResolvedValueOnce(
    okJson({ sessionId: "s", phone: "99887766", shortcode: "144773", text: "1234",
      smsUri: "sms:144773?body=1234", displayInstruction: "...", expiresAt })
  );
  mockFetch.mockResolvedValue(mockStatus("EXPIRED"));

  const promise = verifyPhone("99887766");
  await jest.advanceTimersByTimeAsync(3_100);
  expect(await promise).toBe(false);
});

test("verifyPhone throws descriptive error on 401", async () => {
  mockFetch.mockResolvedValueOnce(errResponse(401, "Unauthorized"));
  await expect(verifyPhone("99887766")).rejects.toThrow("VERIFY_MN_API_KEY is invalid");
});
