# FairShift — Cloud Run Dockerfile
# Zero production npm dependencies; uses Node.js built-ins only.
# Build: docker build -t fairshift .
# Run:   docker run -p 8080:8080 fairshift
# Cloud Run sets PORT automatically; server.js reads process.env.PORT.

FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy only the application source (node_modules is excluded via .dockerignore)
COPY package.json ./
COPY server.js ./
COPY lib/ ./lib/
COPY public/ ./public/

# No npm install required — zero production dependencies.
# Dev/test dependencies are not needed at runtime.

# Run as non-root for Cloud Run security best practices
USER node

# Cloud Run injects PORT; default 8080 matches Cloud Run's expected port
EXPOSE 8080

# Health check (Cloud Run will probe /api/health automatically via startup probe)
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "const h=require('http');h.get('http://localhost:'+(process.env.PORT||8080)+'/api/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
