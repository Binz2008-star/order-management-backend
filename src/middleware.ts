import { monitoringMiddleware } from './server/middleware/simple-monitoring';

export const config = {
  matcher: [
    '/api/:path*',
  ],
};

export default monitoringMiddleware;
