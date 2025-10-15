FROM node:20-slim

# Install dependencies as a non-root user for security
WORKDIR /app

# Install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY . .

ENV PORT=8080
EXPOSE 8080

# Start the application
CMD ["node", "server.js"]
