compiled.css.gz: compiled.css
	gzip -k compiled.css

compiled.css: styles.css
	npx postcss styles.css -o compiled.css
