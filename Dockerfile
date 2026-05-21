FROM node:22-alpine

WORKDIR /app

# Copy application files
COPY package.json ./
COPY server.mjs ./
COPY index.html ./
COPY js/ ./js/
COPY css/ ./css/

# Create directories
RUN mkdir -p logs output config

# Expose port
EXPOSE 8787

# Start the server
CMD ["node", "server.mjs"]
