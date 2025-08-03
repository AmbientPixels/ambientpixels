Mision:
css refactor
We need to break up our current css system into smaller more manageable files. We have one uber css (cardforge-ui.css) and 3 others. We want to establish preferable under 10 css files. We need to determine the best categories or split we need to  make. The uber css file contain duplicate styles we will discover them and remove them as we progress in teh refactor. FIrst lets identify what we currently have 

C:\ambientpixels\EchoGrid\cardforge\css\card-forge.css
C:\ambientpixels\EchoGrid\cardforge\css\cardforge-card.css
C:\ambientpixels\EchoGrid\cardforge\css\cardforge-layout.css

C:\ambientpixels\EchoGrid\cardforge\css\cardforge-ui.css


index
C:\ambientpixels\EchoGrid\cardforge\index.html


once we determin the best fiels to make lets make blank files. 


next we will begin to exteact the css from eh fiels to the newly created files. we need a stepwise approach. this is teh approach. it must be followed every time. 

1 you will copy the css code from teh old (legacy) file to the new file
2 you will add teh reference to index.html
3 I will remove the code manually
4 you will then report what css to remove from the legacy code.  we we dont see changes or minimal changes (from duplicate removals) we will continue

this is a Strick outline of the process to endure we dont miss and also so we have clean code and remove duplicates.  

first list what the legacy css files contain and what they do here:  