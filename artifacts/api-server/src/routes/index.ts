import { Router } from "express";
import healthRouter from "./health.js";
import ngTravelsRouter from "./ng-travels.js";
import cronRouter from "./cron.js";

const router = Router();

router.use(healthRouter);
router.use(cronRouter);
router.use(ngTravelsRouter);

export default router;
