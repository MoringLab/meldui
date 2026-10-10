FROM mcr.microsoft.com/playwright:v1.58.2-noble
WORKDIR /opt/engine
RUN npm install --ignore-scripts --no-audit --no-fund playwright@1.58.2
COPY worker.cjs /opt/engine/worker.cjs
USER pwuser
ENV NODE_ENV=production
ENTRYPOINT ["node","/opt/engine/worker.cjs"]
