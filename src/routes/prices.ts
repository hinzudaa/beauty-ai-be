import { Router, Request, Response } from "express";
import { getSetting } from "../models/settings";

const router = Router();

const DEFAULTS = { basicPrice: 19999, standardPrice: 24999, proPrice: 29999 };

/** Public — no auth required */
router.get("/", async (_req: Request, res: Response) => {
  try {
    const [basicPrice, standardPrice, proPrice] = await Promise.all([
      getSetting<number>("basicPrice",    DEFAULTS.basicPrice),
      getSetting<number>("standardPrice", DEFAULTS.standardPrice),
      getSetting<number>("proPrice",      DEFAULTS.proPrice),
    ]);
    res.json({ basicPrice, standardPrice, proPrice });
  } catch {
    res.json(DEFAULTS);
  }
});

export default router;
