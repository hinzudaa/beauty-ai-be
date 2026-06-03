import { Router, Request, Response } from "express";
import { getSetting } from "../models/settings";

const router = Router();

const DEFAULTS = { basicPrice: 19999, proPrice: 29999 };

/** Public — no auth required */
router.get("/", async (_req: Request, res: Response) => {
  try {
    const [basicPrice, proPrice] = await Promise.all([
      getSetting<number>("basicPrice", DEFAULTS.basicPrice),
      getSetting<number>("proPrice",   DEFAULTS.proPrice),
    ]);
    res.json({ basicPrice, proPrice });
  } catch {
    res.json(DEFAULTS);   // always return something so UI never breaks
  }
});

export default router;
