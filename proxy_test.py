import scrapy
from scrapy.crawler import CrawlerProcess
import socks
import socket

socks.set_default_proxy(socks.SOCKS5, "geo.iproyal.com", 32325, username="AndreyProxy", password="ProxyPassword_country-ca")
socket.socket = socks.socksocket

class MySpider(scrapy.Spider):
    name = 'myspider'
    start_urls = ['https://www.linkedin.com/jobs/view/3713019461/']

    custom_settings = {
        'DOWNLOADER_MIDDLEWARES': {
            'scrapy.downloadermiddlewares.httpproxy.HttpProxyMiddleware': 1,
        },
        'USER_AGENT': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3',
    }

    def parse(self, response):
        for i in range(5):
            yield scrapy.Request(
                url='https://httpbin.org/ip',
                callback=self.print_response,
                dont_filter=True,
            )

    def print_response(self, response):
        self.log(response.text)

if __name__ == "__main__":
    process = CrawlerProcess()
    process.crawl(MySpider)
    process.start()