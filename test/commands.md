# Test commands

## Relayer status

```bash
curl --fail-with-body --silent --show-error \
  http://localhost:9000/status

curl --fail-with-body --silent --show-error \
  http://150.109.25.172:9000/status
```

## Refund quote

```bash
curl --fail-with-body --silent --show-error \
  --request POST \
  --header 'Content-Type: application/json' \
  --data '{"chainId":11142220,"token":"0x01C5C0122039549AD1493B8220cABEdD739BC44E","amount":"20000000","tier":8}' \
  http://localhost:9000/v1/refund/quote
```

## DeFi quote

```bash
curl --fail-with-body --silent --show-error \
  --request POST \
  --header 'Content-Type: application/json' \
  --data '{"chainId":11142220,"token":"0x01C5C0122039549AD1493B8220cABEdD739BC44E","amount":"20000000","tier":8}' \
  http://localhost:9000/v1/defi/quote
```
