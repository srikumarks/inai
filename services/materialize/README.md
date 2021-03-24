# materialize

The materialize service has no end service points. You simply use it by
including `materialize` in the boot sequence in your html page .. like below ..

```
<html>
	<head>
	...
	</head>
	<body inai-boot="... materialize">
	...
	</body>
</html>
```

The "service" introduces the necessary materialize css and scripts so the rest
of the application can rely on it.
