from http.server import BaseHTTPRequestHandler

import requests

import json



class handler(BaseHTTPRequestHandler):

    def do_GET(self):

        try:

            # 1. サーバー（Vercel）が直接Kahootにキーを取りに行く

            # ここは学校のフィルターを通らないので、100%取得できます

            target_url = 'https://apis.kahoot.it/media-api/youtube/key'

            response = requests.get(target_url, timeout=10)

            data = response.json()

           

            # 2. 返事（レスポンス）の準備

            self.send_response(200)

            self.send_header('Content-type', 'application/json')

           

            # 【超重要】CORS対策のヘッダー

            # これがないと、iPadのJavaScriptが「知らない所から来たデータだ」と拒否してしまいます

            self.send_header('Access-Control-Allow-Origin', '*')

            self.send_header('Access-Control-Allow-Methods', 'GET')

            self.end_headers()

           

            # 3. 取得したJSONをそのままiPadに送り返す

            self.wfile.write(json.dumps(data).encode())

           

        except Exception as e:

            # 何かエラーが起きた時の処理

            self.send_response(500)

            self.end_headers()

            self.wfile.write(str(e).encode())