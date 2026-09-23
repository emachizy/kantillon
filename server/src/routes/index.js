import { Router } from 'express';
import healthRoutes from './health.routes.js';
import authRoutes from './auth.routes.js';
import shopRoutes from './shop.routes.js';
import productRoutes from './product.routes.js';
import inventoryRoutes from './inventory.routes.js';
import stockReceiptRoutes from './stockReceipt.routes.js';
import dailySalesReportRoutes from './dailySalesReport.routes.js';
import shopPriceRoutes from './shopPrice.routes.js';
import correctionRequestRoutes from './correctionRequest.routes.js';
import stockVarianceResolutionRoutes from './stockVarianceResolution.routes.js';
import moneyVarianceResolutionRoutes from './moneyVarianceResolution.routes.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/shops', shopRoutes);
router.use('/products', productRoutes);
router.use('/inventory', inventoryRoutes);
router.use('/stock-receipts', stockReceiptRoutes);
router.use('/daily-reports', dailySalesReportRoutes);
router.use('/shop-prices', shopPriceRoutes);
router.use('/correction-requests', correctionRequestRoutes);
router.use('/stock-variance-resolutions', stockVarianceResolutionRoutes);
router.use('/money-variance-resolutions', moneyVarianceResolutionRoutes);

export default router;
