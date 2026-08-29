FROM nginx:1.27-alpine

COPY dist/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.sh /docker-entrypoint-custom.sh

EXPOSE 80
ENTRYPOINT ["/docker-entrypoint-custom.sh"]
